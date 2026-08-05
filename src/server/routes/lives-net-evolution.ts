// api/lives-net-evolution.ts
// AD06: estoque ancorado no KPI de vidas ativas + saídas mensais (users_deleted).
import {
  MDS_PARTNER_SCOPE,
  requireBasicAuth,
  requireMenuAccess,
  scopedGroupNames,
  scopedPartnerBrokerId,
} from "../../../lib/basic-auth";
import { CORE_DATA_MENUS } from "../../dashboard/menu-catalog";
import { createSqlParams, getCell, resolveWarehouseId, runQuery, toInt, type SqlParams } from "../../../lib/databricks";
import { setApiCors } from "../../../lib/http";

type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

const BENEFICIARIES_TABLE = `hive_metastore.sanus_prod.beneficiaries`;
const USERS_DELETED_TABLE = `hive_metastore.sanus_prod.users_deleted`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function parseGroupNames(query: Record<string, any>) {
  const raw = query.group_names;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return [...new Set(parsed.map((v) => String(v).trim()).filter(Boolean))];
    } catch {}
  }
  return query.group_name ? [String(query.group_name).trim()].filter(Boolean) : [];
}

function partnerBrokerCondition(partnerBrokerId: unknown, p: SqlParams) {
  const partnerIds = Array.isArray(partnerBrokerId)
    ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (partnerIds.length) {
    return `CAST(opb.partner_broker_id AS STRING) IN (${p.addAll(partnerIds)})`;
  }
  if (String(partnerBrokerId) === MDS_PARTNER_SCOPE) {
    return `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`;
  }
  return `CAST(opb.partner_broker_id AS STRING) = ${p.add(partnerBrokerId)}`;
}

function partnerOrgIdsSubquery(partnerBrokerId: unknown, p: SqlParams) {
  const partnerCondition = partnerBrokerCondition(partnerBrokerId, p);
  return `(
    SELECT CAST(opb.organization_id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION ALL
    SELECT CAST(child.id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function orgScopeConditions(alias: string, groupNames: string[], company: unknown, partnerBrokerId: unknown, p: SqlParams) {
  const conditions: string[] = [];
  if (groupNames.length) {
    const groupList = p.addAll(groupNames);
    conditions.push(`CAST(${alias}.organization_id AS STRING) IN (
      SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE TRIM(name) IN (${groupList})
      UNION
      SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE}
      WHERE matriz_id IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE TRIM(name) IN (${groupList}))
    )`);
  }
  if (company) {
    const c = p.add(company);
    conditions.push(`CAST(${alias}.organization_id AS STRING) IN (
      SELECT CAST(id AS STRING)
      FROM ${ORGANIZATIONS_TABLE}
      WHERE UPPER(TRIM(CAST(name AS STRING))) = UPPER(TRIM(${c}))
    )`);
  }
  if (partnerBrokerId) {
    conditions.push(`CAST(${alias}.organization_id AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId, p)}`);
  }
  return conditions;
}

function lastNMonthsList(n: number, includeCurrent = true) {
  const out: string[] = [];
  const d = new Date();
  if (!includeCurrent) d.setUTCDate(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    const dd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, CORE_DATA_MENUS)) return;

  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));
  const company = req.query.company || null;
  const partnerBrokerId = await scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const monthsWindow = Math.min(Math.max(parseInt(String(req.query.months || "12"), 10) || 12, 3), 36);
  const displayMonths = lastNMonthsList(monthsWindow, true);
  const params = createSqlParams();

  const entryOrgConds = orgScopeConditions("b", groupNames, company, partnerBrokerId, params);
  const exitOrgConds = orgScopeConditions("d", groupNames, company, partnerBrokerId, params);
  const activeStockWhere = ["o.active = true", ...entryOrgConds].join(" AND ");
  const entryWhere = [
    "b.created_at IS NOT NULL",
    "o.active = true",
    ...entryOrgConds,
  ].join(" AND ");
  const exitDateExpr = `COALESCE(d.date_of_exclusion, d.inactived_at, d.retired_at, d.created_at)`;
  const exitWhere = [
    `${exitDateExpr} IS NOT NULL`,
    `${exitDateExpr} <= CURRENT_TIMESTAMP()`,
    `${exitDateExpr} >= TIMESTAMP('2022-01-01')`,
    ...exitOrgConds,
  ].join(" AND ");
  const monthListSql = displayMonths.map((month) => `'${month}'`).join(",");

  try {
    const warehouseId = await resolveWarehouseId();
    const [stockRows, movementRows] = await Promise.all([
      runQuery(
        warehouseId,
        `
        SELECT COUNT(*) AS estoque_ativo
        FROM ${BENEFICIARIES_TABLE} b
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(b.organization_id AS STRING) = CAST(o.id AS STRING)
        WHERE ${activeStockWhere}
      `,
        params.list,
      ),
      runQuery(
        warehouseId,
        `
        WITH entries AS (
          SELECT
            DATE_FORMAT(b.created_at, 'yyyy-MM') AS mes,
            COUNT(*) AS entradas
          FROM ${BENEFICIARIES_TABLE} b
          INNER JOIN ${ORGANIZATIONS_TABLE} o
            ON CAST(b.organization_id AS STRING) = CAST(o.id AS STRING)
          WHERE ${entryWhere}
            AND DATE_FORMAT(b.created_at, 'yyyy-MM') IN (${monthListSql})
          GROUP BY 1
        ),
        exits AS (
          SELECT
            DATE_FORMAT(${exitDateExpr}, 'yyyy-MM') AS mes,
            COUNT(*) AS saidas
          FROM ${USERS_DELETED_TABLE} d
          WHERE ${exitWhere}
            AND DATE_FORMAT(${exitDateExpr}, 'yyyy-MM') IN (${monthListSql})
          GROUP BY 1
        )
        SELECT
          m.mes,
          COALESCE(e.entradas, 0) AS entradas,
          COALESCE(x.saidas, 0) AS saidas
        FROM (
          ${displayMonths.map((month) => `SELECT '${month}' AS mes`).join(" UNION ALL ")}
        ) m
        LEFT JOIN entries e ON e.mes = m.mes
        LEFT JOIN exits x ON x.mes = m.mes
        ORDER BY m.mes
      `,
        params.list,
      ),
    ]);

    const estoqueAtivo = toInt(stockRows[0]?.[0]);
    const movements = movementRows.map((row) => ({
      mes: String(getCell(row[0]) || ""),
      entradas: toInt(row[1]),
      saidas: toInt(row[2]),
      liquido: toInt(row[1]) - toInt(row[2]),
    })).filter((item) => item.mes);

    // Ancora o estoque no KPI atual (vidas ativas) e reconstrói o histórico do recorte:
    // estoque_fim = KPI; estoque[m] = estoque[m-1] + entradas[m] - saidas[m].
    const netInWindow = movements.reduce((acc, item) => acc + item.liquido, 0);
    let running = estoqueAtivo - netInWindow;
    const series = movements.map((item) => {
      running += item.liquido;
      return {
        mes: item.mes,
        entradas: item.entradas,
        saidas: item.saidas,
        liquido: item.liquido,
        acumulado: running,
      };
    });

    res.status(200).json({
      months: displayMonths,
      series,
      estoque_ativo: estoqueAtivo,
      exit_date_field: "COALESCE(date_of_exclusion, inactived_at, retired_at, created_at)",
      source: {
        stock: "beneficiaries + organizations.active (mesmo KPI demográfico)",
        entries: "beneficiaries.created_at",
        exits: "users_deleted",
      },
      filters: {
        group_name: groupNames[0] || null,
        company,
        partner_broker_id: partnerBrokerId,
        months: monthsWindow,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
