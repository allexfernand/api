// api/data.ts
import { MDS_PARTNER_SCOPE, getDashboardAuth, requireBasicAuth, scopedPartnerBrokerId } from "../lib/basic-auth";

declare const process: { env: Record<string, string | undefined> };

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
type DatabricksRow = DatabricksCell[];
type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};
type Warehouse = { id: string; state?: string };

async function dbFetch(path: string, options: any = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId: string, sql: string): Promise<DatabricksRow[]> {
  let data = await dbFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: "50s", on_wait_timeout: "CONTINUE" }),
  });
  let { statement_id: sid, status: { state } } = data;
  while (state === "PENDING" || state === "RUNNING") {
    await new Promise((r) => setTimeout(r, 2000));
    data = await dbFetch(`/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || "Query falhou: " + state);
  return data.result?.data_array || [];
}

function escape(s: unknown) { return String(s).replace(/'/g, "''"); }
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

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };
const toDate = (v: DatabricksCell) => { const raw = getCell(v); return raw ? String(raw).slice(0, 10) : ""; };
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;
const HEALTHCOACH_TABLE = `hive_metastore.sanus_prod.healthcoach_gold_live`;
const BENEFICIARIES_TABLE = `hive_metastore.sanus_prod.beneficiaries`;

function partnerBrokerCondition(partnerBrokerId: unknown) {
  if (String(partnerBrokerId) === MDS_PARTNER_SCOPE) {
    return `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`;
  }
  return `CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'`;
}

function partnerOrgIdsSubquery(partnerBrokerId: unknown) {
  const partnerCondition = partnerBrokerCondition(partnerBrokerId);
  return `(
    SELECT CAST(opb.organization_id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION
    SELECT CAST(child.id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function quoteIdent(s: unknown) { return `\`${String(s).replace(/`/g, "``")}\``; }

async function getColumns(warehouseId: string, tableName: string) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || '').trim())
    .filter((column) => column && !column.startsWith('#'));
}

function pickColumn(columns: string[], candidates: string[]) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

function buildFilters(groupNames: string[], typeFilter: unknown, partnerBrokerId: unknown) {
  const conditions = [`b.created_at IS NOT NULL`];
  if (groupNames.length) {
    const groupList = groupNames.map((group) => `'${escape(group)}'`).join(",");
    conditions.push(`b.organization_id IN (
      SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name IN (${groupList})
      UNION
      SELECT id FROM hive_metastore.sanus_prod.organizations
      WHERE matriz_id IN (SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name IN (${groupList}))
    )`);
  }
  if (partnerBrokerId) {
    conditions.push(`CAST(b.organization_id AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId)}`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) != 'TITULAR'`);
  }
  return `WHERE ${conditions.join(' AND ')}`;
}

function buildBeneficiaryOrgFilter(beneficiaryColumns: string[], groupNames: string[], company: unknown, partnerBrokerId: unknown) {
  const conditions = [];
  const cpfColumn = pickColumn(beneficiaryColumns, [
    'cpf',
    'CPF',
    'document',
    'documento',
    'cpf_cnpj',
    'document_number',
    'beneficiary_cpf',
    'cpf_beneficiario',
  ]);
  const orgIdColumn = pickColumn(beneficiaryColumns, ['organization_id', 'id_organizacao', 'id_empresa', 'empresa_id']);
  if (!cpfColumn) return '';
  if (groupNames.length && orgIdColumn) {
    const groupList = groupNames.map((group) => `'${escape(group)}'`).join(',');
    conditions.push(`CAST(b.${quoteIdent(orgIdColumn)} AS STRING) IN (
      SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name IN (${groupList})
      UNION
      SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE}
      WHERE matriz_id IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name IN (${groupList}))
    )`);
  }
  if (company) {
    const companyColumn = pickColumn(beneficiaryColumns, ['organization_name', 'nome_empresa', 'empresa', 'NOME_CLIENTE', 'nome_cliente']);
    if (companyColumn) conditions.push(`UPPER(TRIM(CAST(b.${quoteIdent(companyColumn)} AS STRING))) = UPPER(TRIM('${escape(company)}'))`);
  }
  if (partnerBrokerId && orgIdColumn) {
    conditions.push(`CAST(b.${quoteIdent(orgIdColumn)} AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId)}`);
  }
  if (!conditions.length) return '';
  return `EXISTS (
    SELECT 1
    FROM ${BENEFICIARIES_TABLE} b
    WHERE REGEXP_REPLACE(CAST(b.${quoteIdent(cpfColumn)} AS STRING), '[^0-9]', '') = REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')
      AND ${conditions.join(' AND ')}
  )`;
}

function buildCareLineFilters(columns: string[], beneficiaryColumns: string[], query: Record<string, any>, groupNames: string[], company: unknown, partnerBrokerId: unknown) {
  const conditions = [
    `cpf_atendido IS NOT NULL`,
    `TRIM(CAST(cpf_atendido AS STRING)) != ''`,
    `classificacoes IS NOT NULL`,
    `TRIM(CAST(classificacoes AS STRING)) != ''`,
    `CAST(classificacoes AS STRING) RLIKE '^[A-Za-zÀ-ú]'`,
  ];
  const meses = query.meses ? String(query.meses).split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const dateColumn = pickColumn(columns, [
    'created_at',
    'creation_time',
    'event_timestamp',
    'data_atendimento',
    'data_criacao',
    'dt_atendimento',
    'updated_at',
  ]);
  if (dateColumn && meses.length) {
    conditions.push(`DATE_FORMAT(try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((month) => `'${escape(month)}'`).join(',')})`);
  }

  const orgIdColumn = pickColumn(columns, ['organization_id', 'id_organizacao', 'id_empresa', 'empresa_id']);
  const companyColumn = pickColumn(columns, ['organization_name', 'nome_empresa', 'empresa', 'NOME_CLIENTE', 'nome_cliente', 'nome_conta']);
  const groupColumn = pickColumn(columns, ['economic_group_canonical', 'economic_group_name', 'grupo_economico', 'name_economic_group']);
  let groupApplied = false;
  let companyApplied = false;
  let partnerApplied = false;

  if (company && companyColumn) {
    conditions.push(`UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) = UPPER(TRIM('${escape(company)}'))`);
    companyApplied = true;
  }

  if (groupNames.length) {
    const groupList = groupNames.map((group) => `'${escape(group)}'`).join(',');
    if (orgIdColumn) {
      groupApplied = true;
      conditions.push(`CAST(${quoteIdent(orgIdColumn)} AS STRING) IN (
        SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name IN (${groupList})
        UNION
        SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE}
        WHERE matriz_id IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name IN (${groupList}))
      )`);
    } else if (groupColumn) {
      groupApplied = true;
      conditions.push(`UPPER(TRIM(CAST(${quoteIdent(groupColumn)} AS STRING))) IN (${groupNames.map((group) => `UPPER(TRIM('${escape(group)}'))`).join(',')})`);
    }
  }

  if (partnerBrokerId) {
    if (orgIdColumn) {
      partnerApplied = true;
      conditions.push(`CAST(${quoteIdent(orgIdColumn)} AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId)}`);
    } else if (companyColumn) {
      partnerApplied = true;
      conditions.push(`UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN (
        SELECT UPPER(TRIM(CAST(o.name AS STRING)))
        FROM ${ORGANIZATIONS_TABLE} o
        WHERE CAST(o.id AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId)}
      )`);
    }
  }

  const needsBeneficiaryOrgFilter =
    (groupNames.length && !groupApplied) ||
    (company && !companyApplied) ||
    (partnerBrokerId && !partnerApplied);
  if (needsBeneficiaryOrgFilter) {
    const beneficiaryFilter = buildBeneficiaryOrgFilter(
      beneficiaryColumns,
      groupApplied ? [] : groupNames,
      companyApplied ? null : company,
      partnerApplied ? null : partnerBrokerId,
    );
    if (beneficiaryFilter) conditions.push(beneficiaryFilter);
  }

  return conditions.join(' AND ');
}

function careCategoryExpr() {
  const normalized = `LOWER(TRIM(CAST(categoria_atendimento AS STRING)))`;
  return `CASE
    WHEN ${normalized} IN ('tabegismo', 'tagabismo', 'tabagismo') THEN 'Tabagismo'
    WHEN ${normalized} IN ('saude mental', 'saúde mental', 'saude mental descompensada', 'saúde mental descompensada') THEN 'Saúde mental'
    ELSE TRIM(CAST(categoria_atendimento AS STRING))
  END`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;

  const groupNames = parseGroupNames(req.query);
  const typeFilter = req.query.type || null;
  const partnerBrokerId = scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const scope = String(req.query.scope || '').toLowerCase();
  if (scope === 'auth') return res.status(200).json({ ok: true, role: getDashboardAuth(req)?.role || 'full' });
  const groupFilter = buildFilters(groupNames, typeFilter, partnerBrokerId);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    if (scope === 'partners') {
      const partnerRows = await runQuery(wh.id, `
        WITH partner_orgs AS (
          SELECT
            CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
            CAST(opb.organization_id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          WHERE opb.deleted_at IS NULL
          UNION
          SELECT
            CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
            CAST(child.id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          INNER JOIN ${ORGANIZATIONS_TABLE} child
            ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
          WHERE opb.deleted_at IS NULL
        )
        SELECT
          CAST(pb.id AS STRING) AS broker_id,
          COALESCE(
            NULLIF(TRIM(CAST(pb.name AS STRING)), ''),
            NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
            'Sem nome'
          ) AS broker_name,
          NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), '') AS broker_name_secondary,
          pb.active AS broker_active,
          COUNT(DISTINCT po.organization_id) AS total_orgs
        FROM partner_orgs po
        INNER JOIN ${PARTNER_BROKERS_TABLE} pb
          ON po.partner_broker_id = CAST(pb.id AS STRING)
        WHERE pb.id IS NOT NULL
          ${String(partnerBrokerId) === MDS_PARTNER_SCOPE ? "AND (UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS' OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS')" : ""}
        GROUP BY
          CAST(pb.id AS STRING),
          COALESCE(
            NULLIF(TRIM(CAST(pb.name AS STRING)), ''),
            NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
            'Sem nome'
          ),
          NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
          pb.active
        ORDER BY broker_name ASC
      `);
      const partners = partnerRows.map((r) => ({
        broker_id: String(getCell(r[0]) || '').trim(),
        broker_name: String(getCell(r[1]) || 'Sem nome').trim(),
        broker_name_secondary: getCell(r[2]) ? String(getCell(r[2])).trim() : '',
        broker_active: String(getCell(r[3])).toLowerCase() === 'true',
        total_orgs: toInt(r[4]),
      })).filter((partner) => partner.broker_id);
      return res.status(200).json({ partners, auth_role: getDashboardAuth(req)?.role || 'full', updatedAt: new Date().toISOString() });
    }

    if (scope === 'care_lines') {
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const company = req.query.company || null;
      const where = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId);
      const rows = await runQuery(wh.id, `
        SELECT
          TRIM(CAST(classificacoes AS STRING)) AS classificacoes,
          COUNT(DISTINCT REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')) AS total_cpfs
        FROM ${HEALTHCOACH_TABLE}
        WHERE ${where}
        GROUP BY TRIM(CAST(classificacoes AS STRING))
        ORDER BY total_cpfs DESC
        LIMIT 30
      `);
      const items = rows.map((row) => ({
        classificacoes: String(getCell(row[0]) || '').trim(),
        total_cpfs: toInt(row[1]),
      })).filter((item) => item.classificacoes);
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      return res.status(200).json({
        scope: 'care_lines',
        items,
        total,
        filters: {
          period: Boolean(req.query.meses),
          group_names: groupNames,
          company,
          partner_broker_id: partnerBrokerId,
        },
        source: HEALTHCOACH_TABLE,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    if (scope === 'care_line_detail') {
      const classificacao = String(req.query.classificacao || '').trim();
      if (!classificacao) return res.status(400).json({ error: "Classificação obrigatória." });
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId);
      const category = careCategoryExpr();
      const rows = await runQuery(wh.id, `
        SELECT
          ${category} AS categoria_atendimento,
          COUNT(DISTINCT REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')) AS total_cpfs
        FROM ${HEALTHCOACH_TABLE}
        WHERE ${baseWhere}
          AND TRIM(CAST(classificacoes AS STRING)) = '${escape(classificacao)}'
          AND categoria_atendimento IS NOT NULL
          AND TRIM(CAST(categoria_atendimento AS STRING)) != ''
        GROUP BY ${category}
        ORDER BY total_cpfs DESC
        LIMIT 50
      `);
      const items = rows.map((row) => ({
        categoria_atendimento: String(getCell(row[0]) || '').trim(),
        total_cpfs: toInt(row[1]),
      })).filter((item) => item.categoria_atendimento);
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      return res.status(200).json({
        scope: 'care_line_detail',
        classificacao,
        items,
        total,
        source: HEALTHCOACH_TABLE,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    const [userRows, groupRows, sessionGroupRows] = await Promise.all([
      runQuery(wh.id, `
        SELECT DATE_TRUNC('DAY', b.created_at) AS dia, COUNT(DISTINCT b.id) AS n
        FROM hive_metastore.sanus_prod.beneficiaries b
        ${groupFilter}
        GROUP BY 1 ORDER BY 1
      `),
      !groupNames.length ? runQuery(wh.id, partnerBrokerId ? `
        WITH partner_orgs AS (
          SELECT CAST(opb.organization_id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          WHERE ${partnerBrokerCondition(partnerBrokerId)}
            AND opb.deleted_at IS NULL
          UNION
          SELECT CAST(child.id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          INNER JOIN ${ORGANIZATIONS_TABLE} child
            ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
          WHERE ${partnerBrokerCondition(partnerBrokerId)}
            AND opb.deleted_at IS NULL
        )
        SELECT
          COALESCE(
            NULLIF(TRIM(CAST(parent.name AS STRING)), ''),
            NULLIF(TRIM(CAST(o.name AS STRING)), '')
          ) AS grupo,
          COUNT(DISTINCT CAST(o.id AS STRING)) AS total_filiais
        FROM partner_orgs po
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(o.id AS STRING) = po.organization_id
        LEFT JOIN ${ORGANIZATIONS_TABLE} parent
          ON CAST(parent.id AS STRING) = CAST(o.matriz_id AS STRING)
        WHERE COALESCE(
            NULLIF(TRIM(CAST(parent.name AS STRING)), ''),
            NULLIF(TRIM(CAST(o.name AS STRING)), '')
          ) IS NOT NULL
        GROUP BY
          COALESCE(
            NULLIF(TRIM(CAST(parent.name AS STRING)), ''),
            NULLIF(TRIM(CAST(o.name AS STRING)), '')
          )
        ORDER BY grupo ASC
      ` : `
        SELECT o.name AS grupo, 0 AS total_filiais
        FROM hive_metastore.sanus_prod.organizations o
        WHERE o.active = true
          AND o.name IS NOT NULL
          AND TRIM(CAST(o.name AS STRING)) != ''
          AND (o.is_matriz = true OR o.matriz_id IS NULL)
        ORDER BY o.name ASC
      `) : Promise.resolve(null),
      !groupNames.length ? runQuery(wh.id, `
        SELECT economic_group_canonical AS grupo, COUNT(*) AS total_sessions
        FROM hive_metastore.sanus_prod.dashboard_sessions_base_gold
        WHERE economic_group_canonical IS NOT NULL
          AND TRIM(economic_group_canonical) != ''
        GROUP BY economic_group_canonical
        ORDER BY total_sessions DESC
      `).catch(() => null) : Promise.resolve(null),
    ]);

    const parse = (rows: DatabricksRow[] | null) => (rows || []).map((r) => [toDate(r[0]), toInt(r[1])]);
    const groups = groupRows
      ? groupRows.map((r) => ({
          economic_group: getCell(r[0]) ? String(getCell(r[0])).trim() : null,
          total_orgs: toInt(r[1]),
        })).filter((g) => g.economic_group)
      : null;
    const sessions_groups = sessionGroupRows
      ? sessionGroupRows.map((r) => ({
          economic_group: getCell(r[0]) ? String(getCell(r[0])).trim() : null,
          total_sessions: toInt(r[1]),
        })).filter((g) => g.economic_group)
      : null;

    res.status(200).json({ users: parse(userRows), groups, sessions_groups, auth_role: getDashboardAuth(req)?.role || 'full', updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
