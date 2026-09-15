import {
  requireBasicAuth,
  requireMenuAccess,
  scopedPartnerBrokerIds,
} from "../../../lib/basic-auth";
import {
  createSqlParams,
  getCell,
  getColumns,
  quoteIdent,
  resolveWarehouseId,
  runQuery,
  toInt,
} from "../../../lib/databricks";
import { setApiCors, setStableCache } from "../../../lib/http";
import {
  appointmentRecordColumnCandidates,
  assuntoExclusionSql,
  companyColumnCandidates,
} from "./appointments-evolution";

type ApiRequest = { method?: string; query: Record<string, unknown> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

const BENEFICIARIES = "hive_metastore.sanus_prod.beneficiaries";
const ORGANIZATIONS = "hive_metastore.sanus_prod.organizations";
const ORGANIZATION_PARTNERS = "hive_metastore.sanus_prod.organization_partner_brokers";
const SESSIONS = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";
const APPOINTMENTS = "hive_metastore.sanus_prod.atendimento_summarized_gold_live";

function parseList(value: unknown, pattern?: RegExp) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map((item) => String(item).trim()).filter((item) => item && (!pattern || pattern.test(item))))].slice(0, 50);
}

function parsePartnerIds(value: unknown) {
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      return parseList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return parseList(value);
}

function pickColumn(columns: string[], candidates: string[]) {
  const indexed = new Map(columns.map((column) => [column.toLowerCase(), column]));
  return candidates.map((candidate) => indexed.get(candidate.toLowerCase())).find(Boolean) || null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, ["visao-parceiros"])) return;

  const requestedIds = parsePartnerIds(req.query.partner_broker_ids);
  const partnerIds = await scopedPartnerBrokerIds(req, requestedIds);
  if (!partnerIds.length) return res.status(200).json({ partners: [], groups: [] });
  const months = parseList(req.query.meses, /^\d{4}-\d{2}$/);
  if (!months.length) return res.status(400).json({ error: "Informe ao menos um mês válido em meses." });

  try {
    const warehouseId = await resolveWarehouseId();
    const appointmentColumns = await getColumns(warehouseId, APPOINTMENTS);
    const companyColumn = pickColumn(appointmentColumns, companyColumnCandidates);
    const recordColumn = pickColumn(appointmentColumns, appointmentRecordColumnCandidates);
    if (!companyColumn) {
      return res.status(422).json({ error: "A fonte de agendamentos não possui uma coluna de empresa compatível." });
    }

    const params = createSqlParams();
    const partnerMarkers = params.addAll(partnerIds);
    const monthSql = months.map((month) => `'${month}'`).join(",");
    const partnerOrgs = `
      WITH partner_orgs AS (
        SELECT DISTINCT
          CAST(opb.partner_broker_id AS STRING) AS partner_id,
          CAST(o.id AS STRING) AS organization_id,
          UPPER(TRIM(CAST(o.name AS STRING))) AS organization_name,
          COALESCE(
            NULLIF(TRIM(CAST(parent.name AS STRING)), ''),
            NULLIF(TRIM(CAST(o.name AS STRING)), ''),
            'Sem grupo'
          ) AS economic_group
        FROM ${ORGANIZATION_PARTNERS} opb
        INNER JOIN ${ORGANIZATIONS} root
          ON CAST(root.id AS STRING) = CAST(opb.organization_id AS STRING)
        INNER JOIN ${ORGANIZATIONS} o
          ON CAST(o.id AS STRING) = CAST(root.id AS STRING)
          OR CAST(o.matriz_id AS STRING) = CAST(root.id AS STRING)
        LEFT JOIN ${ORGANIZATIONS} parent
          ON CAST(parent.id AS STRING) = CAST(o.matriz_id AS STRING)
        WHERE CAST(opb.partner_broker_id AS STRING) IN (${partnerMarkers})
          AND opb.deleted_at IS NULL
      )`;

    const appointmentVolume = recordColumn
      ? `COUNT(DISTINCT CAST(a.${quoteIdent(recordColumn)} AS STRING))`
      : "COUNT(*)";
    const [livesRows, sessionRows, appointmentRows] = await Promise.all([
      runQuery(warehouseId, `${partnerOrgs}
        SELECT po.partner_id, po.economic_group, COUNT(DISTINCT CAST(b.id AS STRING)) AS lives
        FROM partner_orgs po
        INNER JOIN ${BENEFICIARIES} b
          ON CAST(b.organization_id AS STRING) = po.organization_id
        GROUP BY po.partner_id, po.economic_group
      `, params.list),
      runQuery(warehouseId, `${partnerOrgs}
        SELECT
          po.partner_id,
          po.economic_group,
          s.mes,
          UPPER(TRIM(CAST(s.tipo_atendimento_agent AS STRING))) AS attendance_type,
          COUNT(*) AS sessions
        FROM partner_orgs po
        INNER JOIN ${SESSIONS} s
          ON CAST(s.organization_id AS STRING) = po.organization_id
        WHERE s.mes IN (${monthSql})
        GROUP BY po.partner_id, po.economic_group, s.mes, UPPER(TRIM(CAST(s.tipo_atendimento_agent AS STRING)))
      `, params.list),
      runQuery(warehouseId, `${partnerOrgs}
        SELECT
          po.partner_id,
          po.economic_group,
          DATE_FORMAT(try_cast(a.hora_criacao_atendimento AS TIMESTAMP), 'yyyy-MM') AS mes,
          ${appointmentVolume} AS appointments
        FROM partner_orgs po
        INNER JOIN ${APPOINTMENTS} a
          ON UPPER(TRIM(CAST(a.${quoteIdent(companyColumn)} AS STRING))) = po.organization_name
        WHERE DATE_FORMAT(try_cast(a.hora_criacao_atendimento AS TIMESTAMP), 'yyyy-MM') IN (${monthSql})
          ${assuntoExclusionSql("a")}
        GROUP BY po.partner_id, po.economic_group, DATE_FORMAT(try_cast(a.hora_criacao_atendimento AS TIMESTAMP), 'yyyy-MM')
      `, params.list),
    ]);

    type Summary = {
      partner_id: string;
      economic_group: string;
      lives: number;
      sessions: number;
      appointments: number;
      sessions_by_month: Record<string, number>;
    };
    const summaries = new Map<string, Summary>();
    const ensure = (partnerId: string, economicGroup: string) => {
      const key = `${partnerId}\u0000${economicGroup}`;
      let summary = summaries.get(key);
      if (!summary) {
        summary = {
          partner_id: partnerId,
          economic_group: economicGroup,
          lives: 0,
          sessions: 0,
          appointments: 0,
          sessions_by_month: Object.fromEntries(months.map((month) => [month, 0])),
        };
        summaries.set(key, summary);
      }
      return summary;
    };

    livesRows.forEach((row) => {
      ensure(String(getCell(row[0]) || ""), String(getCell(row[1]) || "Sem grupo")).lives += toInt(row[2]);
    });
    sessionRows.forEach((row) => {
      const summary = ensure(String(getCell(row[0]) || ""), String(getCell(row[1]) || "Sem grupo"));
      const month = String(getCell(row[2]) || "");
      const total = toInt(row[4]);
      summary.sessions += total;
      summary.sessions_by_month[month] = (summary.sessions_by_month[month] || 0) + total;
    });
    appointmentRows.forEach((row) => {
      ensure(String(getCell(row[0]) || ""), String(getCell(row[1]) || "Sem grupo")).appointments += toInt(row[3]);
    });

    const groups = [...summaries.values()];
    const partners = partnerIds.map((partnerId) => {
      const rows = groups.filter((row) => row.partner_id === partnerId);
      return {
        partner_id: partnerId,
        lives: rows.reduce((sum, row) => sum + row.lives, 0),
        sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
        appointments: rows.reduce((sum, row) => sum + row.appointments, 0),
        sessions_by_month: Object.fromEntries(months.map((month) => [
          month,
          rows.reduce((sum, row) => sum + (row.sessions_by_month[month] || 0), 0),
        ])),
      };
    });

    setStableCache(res);
    return res.status(200).json({ months, partners, groups });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
