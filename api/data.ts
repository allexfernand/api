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
    UNION ALL
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

function pickBeneficiaryCpfColumn(columns: string[]) {
  return pickColumn(columns, [
    'cpf',
    'CPF',
    'document',
    'documento',
    'cpf_cnpj',
    'document_number',
    'beneficiary_cpf',
    'cpf_beneficiario',
  ]);
}

function pickBeneficiaryKinshipColumn(columns: string[]) {
  return pickColumn(columns, ['type_kinship', 'GRAU_PARENTESCO', 'grau_parentesco', 'kinship', 'tipo_beneficiario']);
}

function parseCareTypeBreakdown(rows: any[]) {
  return rows.reduce((acc, row) => {
    const tipo = String(getCell(row[0]) || '').trim().toUpperCase();
    const total = toInt(row[1]);
    if (tipo === 'TITULAR') acc.titulares += total;
    else if (tipo === 'DEPENDENTE') acc.dependentes += total;
    return acc;
  }, { titulares: 0, dependentes: 0 });
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

function buildBeneficiaryOrgFilter(beneficiaryColumns: string[], groupNames: string[], company: unknown, partnerBrokerId: unknown, typeFilter: unknown = null) {
  const conditions = [];
  const cpfColumn = pickBeneficiaryCpfColumn(beneficiaryColumns);
  const orgIdColumn = pickColumn(beneficiaryColumns, ['organization_id', 'id_organizacao', 'id_empresa', 'empresa_id']);
  const kinshipColumn = pickBeneficiaryKinshipColumn(beneficiaryColumns);
  const normalizedType = String(typeFilter || '').trim().toUpperCase();
  const hasTypeFilter = normalizedType === 'TITULAR' || normalizedType === 'DEPENDENTE';
  if (!cpfColumn) return hasTypeFilter ? '1 = 0' : '';
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
  if (hasTypeFilter) {
    if (!kinshipColumn) return '1 = 0';
    if (normalizedType === 'TITULAR') {
      conditions.push(`UPPER(TRIM(COALESCE(b.${quoteIdent(kinshipColumn)},''))) = 'TITULAR'`);
    } else if (normalizedType === 'DEPENDENTE') {
      conditions.push(`UPPER(TRIM(COALESCE(b.${quoteIdent(kinshipColumn)},''))) != 'TITULAR'`);
    }
  }
  if (!conditions.length) return '';
  return `EXISTS (
    SELECT 1
    FROM ${BENEFICIARIES_TABLE} b
    WHERE REGEXP_REPLACE(CAST(b.${quoteIdent(cpfColumn)} AS STRING), '[^0-9]', '') = REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')
      AND ${conditions.join(' AND ')}
  )`;
}

function pickCareDateColumn(columns: string[]) {
  return pickColumn(columns, [
    'hora_criacao_atendimento',
    'data_criacao',
    'data_de_criacao',
    'dt_criacao',
    'created_date',
    'created_at',
    'creation_time',
    'event_timestamp',
    'data_atendimento',
    'dt_atendimento',
    'updated_at',
  ]);
}

function pickBmiColumn(columns: string[]) {
  return pickColumn(columns, ['imc', 'IMC', 'bmi', 'BMI', 'indice_massa_corporal', 'indice_de_massa_corporal']);
}

function pickRiskPriorityColumn(columns: string[]) {
  return pickColumn(columns, ['prioridade_atendimento', 'prioridade', 'risco', 'risco_atendimento', 'priority']);
}

function pickCareStatusColumn(columns: string[]) {
  return pickColumn(columns, ['status', 'status_atendimento', 'status_registro', 'situacao', 'state']);
}

function pickCareIdColumn(columns: string[]) {
  return pickColumn(columns, [
    'id',
    'ID',
    'atendimento_id',
    'id_atendimento',
    'id_healthcoach',
    'id_healthcoach_live',
    'healthcoach_id',
    'health_coach_id',
    'healthcoach_live_id',
    'record_id',
    'registro_id',
    'id_registro',
    'uuid',
  ]);
}

function careCaseIdExpr(columns: string[]): string {
  const idColumn = pickCareIdColumn(columns);
  if (idColumn) {
    return `NULLIF(TRIM(CAST(${quoteIdent(idColumn)} AS STRING)), '')`;
  }
  return `CONCAT(
    'CPF:', REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', ''),
    '|CL:', COALESCE(${careClassificationExpr()}, ''),
    '|CT:', COALESCE(${careCategoryExpr()}, '')
  )`;
}

function pickCareSubjectColumn(columns: string[]) {
  return pickColumn(columns, ['assunto', 'subject', 'categoria_atendimento', 'tipo_atendimento', 'motivo', 'tema']);
}

function pickGestationalWeekColumn(columns: string[]) {
  return pickColumn(columns, [
    'qual_semana_gestacional',
    'qual_a_semana_gestacional',
    'semana_gestacional',
    'semanas_gestacionais',
    'idade_gestacional',
    'gestational_week',
    'weeks_pregnant',
  ]);
}

function openLatestStatusCondition(columnAlias = 'status_norm') {
  return `COALESCE(${columnAlias}, '') NOT IN ('fechado', 'fechada', 'closed', 'encerrado', 'encerrada', 'finalizado', 'finalizada')`;
}

function buildCareLineFilters(columns: string[], beneficiaryColumns: string[], query: Record<string, any>, groupNames: string[], company: unknown, partnerBrokerId: unknown, includeDateFilter = true) {
  const conditions = [
    `cpf_atendido IS NOT NULL`,
    `TRIM(CAST(cpf_atendido AS STRING)) != ''`,
    `classificacoes IS NOT NULL`,
    `TRIM(CAST(classificacoes AS STRING)) != ''`,
    `CAST(classificacoes AS STRING) RLIKE '^[A-Za-zÀ-ú]'`,
  ];
  const meses = query.meses ? String(query.meses).split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const dateColumn = pickCareDateColumn(columns);
  if (includeDateFilter && dateColumn && meses.length) {
    conditions.push(`DATE_FORMAT(try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((month) => `'${escape(month)}'`).join(',')})`);
  }

  const orgIdColumn = pickColumn(columns, ['organization_id', 'id_organizacao', 'id_empresa', 'empresa_id']);
  const companyColumn = pickColumn(columns, ['organization_name', 'nome_empresa', 'empresa', 'NOME_CLIENTE', 'nome_cliente', 'nome_conta']);
  const groupColumn = pickColumn(columns, ['economic_group_canonical', 'economic_group_name', 'grupo_economico', 'name_economic_group']);
  let groupApplied = false;
  let companyApplied = false;
  let partnerApplied = false;
  const typeFilter = String(query.type || '').trim().toUpperCase();
  const hasTypeFilter = typeFilter === 'TITULAR' || typeFilter === 'DEPENDENTE';

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
    (partnerBrokerId && !partnerApplied) ||
    hasTypeFilter;
  if (needsBeneficiaryOrgFilter) {
    const beneficiaryFilter = buildBeneficiaryOrgFilter(
      beneficiaryColumns,
      groupApplied ? [] : groupNames,
      companyApplied ? null : company,
      partnerApplied ? null : partnerBrokerId,
      hasTypeFilter ? typeFilter : null,
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

function careClassificationExpr() {
  const normalized = `LOWER(TRIM(CAST(classificacoes AS STRING)))`;
  return `CASE
    WHEN ${normalized} IN ('cronico', 'crônico') THEN 'Crônico'
    WHEN ${normalized} IN ('situacional', 'situacionais') THEN 'Situacional'
    ELSE TRIM(CAST(classificacoes AS STRING))
  END`;
}

function parseClassNames(query: Record<string, any>) {
  const raw = query.class_names;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return [...new Set(parsed.map((value) => String(value).trim()).filter(Boolean))];
  } catch {}
  return String(raw).split(',').map((value) => value.trim()).filter(Boolean);
}

function literalRows(values: string[], columnName: string) {
  if (!values.length) return `SELECT '' AS ${columnName} WHERE false`;
  return values.map((value) => `SELECT '${escape(value)}' AS ${columnName}`).join('\nUNION ALL\n');
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
          UNION ALL
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
      const includeActiveMapped = String(req.query.include_active_mapped || '') === '1';
      const activeOnly = String(req.query.active_only || '') === '1';
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const company = req.query.company || null;
      const where = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId);
      const classification = careClassificationExpr();
      const caseIdExpr = careCaseIdExpr(columns);
      const activeDateColumn = activeOnly ? pickCareDateColumn(columns) : null;
      const activeStatusColumn = activeOnly ? pickCareStatusColumn(columns) : null;
      if (activeOnly && !activeDateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      if (activeOnly && !activeStatusColumn) return res.status(400).json({ error: "Coluna de status não encontrada em healthcoach_gold_live." });
      const rows = await runQuery(wh.id, activeOnly ? `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            ${classification} AS classificacoes,
            LOWER(TRIM(CAST(${quoteIdent(activeStatusColumn)} AS STRING))) AS status_norm,
            try_cast(${quoteIdent(activeDateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${where}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            classificacoes,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        )
        SELECT
          classificacoes,
          COUNT(DISTINCT cpf_norm) AS total_cpfs
        FROM latest_per_case
        WHERE rn = 1
          AND ${openLatestStatusCondition()}
        GROUP BY classificacoes
        ORDER BY total_cpfs DESC
        LIMIT 30
      ` : `
        SELECT
          ${classification} AS classificacoes,
          COUNT(DISTINCT REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')) AS total_cpfs
        FROM ${HEALTHCOACH_TABLE}
        WHERE ${where}
        GROUP BY ${classification}
        ORDER BY total_cpfs DESC
        LIMIT 30
      `);
      const mappedRows = await runQuery(wh.id, `
        SELECT
          COUNT(DISTINCT REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')) AS mapped_cpfs
        FROM ${HEALTHCOACH_TABLE}
        WHERE ${where}
      `);
      const dateColumn = includeActiveMapped ? pickCareDateColumn(columns) : null;
      const statusColumn = includeActiveMapped ? pickCareStatusColumn(columns) : null;
      const activeMappedRows = includeActiveMapped && dateColumn && statusColumn ? await runQuery(wh.id, `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING))) AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${where}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        )
        SELECT COUNT(DISTINCT cpf_norm) AS active_mapped_cpfs
        FROM latest_per_case
        WHERE rn = 1
          AND ${openLatestStatusCondition()}
      `) : [];
      const beneficiaryCpfColumn = pickBeneficiaryCpfColumn(beneficiaryColumns);
      const beneficiaryKinshipColumn = pickBeneficiaryKinshipColumn(beneficiaryColumns);
      const typeBreakdownRows = beneficiaryCpfColumn && beneficiaryKinshipColumn ? await runQuery(wh.id, activeOnly ? `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            LOWER(TRIM(CAST(${quoteIdent(activeStatusColumn)} AS STRING))) AS status_norm,
            try_cast(${quoteIdent(activeDateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${where}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        scoped AS (
          SELECT DISTINCT cpf_norm
          FROM latest_per_case
          WHERE rn = 1
            AND ${openLatestStatusCondition()}
        ),
        beneficiary_types AS (
          SELECT
            REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '') AS cpf_norm,
            CASE
              WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.${quoteIdent(beneficiaryKinshipColumn)},''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
              ELSE 'DEPENDENTE'
            END AS tipo
          FROM ${BENEFICIARIES_TABLE} b
          WHERE b.${quoteIdent(beneficiaryCpfColumn)} IS NOT NULL
            AND TRIM(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING)) != ''
          GROUP BY REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '')
        )
        SELECT bt.tipo, COUNT(DISTINCT s.cpf_norm) AS total_cpfs
        FROM scoped s
        INNER JOIN beneficiary_types bt ON bt.cpf_norm = s.cpf_norm
        GROUP BY bt.tipo
      ` : `
        WITH scoped AS (
          SELECT DISTINCT REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${where}
        ),
        beneficiary_types AS (
          SELECT
            REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '') AS cpf_norm,
            CASE
              WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.${quoteIdent(beneficiaryKinshipColumn)},''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
              ELSE 'DEPENDENTE'
            END AS tipo
          FROM ${BENEFICIARIES_TABLE} b
          WHERE b.${quoteIdent(beneficiaryCpfColumn)} IS NOT NULL
            AND TRIM(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING)) != ''
          GROUP BY REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '')
        )
        SELECT bt.tipo, COUNT(DISTINCT s.cpf_norm) AS total_cpfs
        FROM scoped s
        INNER JOIN beneficiary_types bt ON bt.cpf_norm = s.cpf_norm
        GROUP BY bt.tipo
      `) : [];
      const items = rows.map((row) => ({
        classificacoes: String(getCell(row[0]) || '').trim(),
        total_cpfs: toInt(row[1]),
      })).filter((item) => item.classificacoes);
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      const mapped_total = toInt(mappedRows[0]?.[0]);
      const active_mapped_total = includeActiveMapped && dateColumn && statusColumn ? toInt(activeMappedRows[0]?.[0]) : null;
      return res.status(200).json({
        scope: 'care_lines',
        items,
        total,
        mapped_total,
        active_mapped_total,
        type_breakdown: parseCareTypeBreakdown(typeBreakdownRows),
        filters: {
          period: Boolean(req.query.meses),
          active_only: activeOnly,
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
      const classNames = parseClassNames(req.query);
      const detailClasses = classNames.length ? classNames : [classificacao].filter(Boolean);
      if (!detailClasses.length) return res.status(400).json({ error: "Classificação obrigatória." });
      const activeOnly = String(req.query.active_only || '') === '1';
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId);
      const category = careCategoryExpr();
      const classification = careClassificationExpr();
      const caseIdExpr = careCaseIdExpr(columns);
      const detailClassList = detailClasses.map((name) => `'${escape(name)}'`).join(',');
      const dateColumn = pickCareDateColumn(columns);
      const statusColumn = activeOnly ? pickCareStatusColumn(columns) : null;
      const idColumn = pickCareIdColumn(columns);
      const subjectColumn = pickCareSubjectColumn(columns);
      const idColumnLabel = idColumn || 'cpf_atendido + data_criacao';
      const idSelectExpr = idColumn
        ? `NULLIF(TRIM(CAST(${quoteIdent(idColumn)} AS STRING)), '')`
        : `CONCAT(
            'CPF ', REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', ''),
            ' | ', COALESCE(DATE_FORMAT(try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP), 'yyyy-MM-dd HH:mm:ss'), 'sem data')
          )`;
      const subjectSelectExpr = subjectColumn
        ? `COALESCE(NULLIF(TRIM(CAST(${quoteIdent(subjectColumn)} AS STRING)), ''), ${category})`
        : category;
      if (!dateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      if (activeOnly && !statusColumn) return res.status(400).json({ error: "Coluna de status não encontrada em healthcoach_gold_live." });
      const rows = await runQuery(wh.id, activeOnly ? `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${classification} AS classificacao,
            ${category} AS categoria_atendimento,
            ${caseIdExpr} AS atendimento_id,
            ${idSelectExpr} AS atendimento_label,
            LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING))) AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            classificacao,
            categoria_atendimento,
            atendimento_id,
            atendimento_label,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        )
        SELECT
          classificacao,
          COALESCE(NULLIF(TRIM(CAST(categoria_atendimento AS STRING)), ''), 'Sem categoria') AS categoria_atendimento,
          COUNT(DISTINCT cpf_norm) AS total_cpfs,
          CONCAT_WS(', ', SLICE(SORT_ARRAY(COLLECT_SET(atendimento_label)), 1, 5)) AS example_ids
        FROM latest_per_case
        WHERE rn = 1
          AND classificacao IN (${detailClassList})
          AND ${openLatestStatusCondition()}
        GROUP BY classificacao, COALESCE(NULLIF(TRIM(CAST(categoria_atendimento AS STRING)), ''), 'Sem categoria')
        ORDER BY total_cpfs DESC
        LIMIT 50
      ` : `
        SELECT
          ${classification} AS classificacao,
          ${category} AS categoria_atendimento,
          COUNT(DISTINCT REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')) AS total_cpfs,
          CONCAT_WS(', ', SLICE(SORT_ARRAY(COLLECT_SET(${idSelectExpr})), 1, 5)) AS example_ids
        FROM ${HEALTHCOACH_TABLE}
        WHERE ${baseWhere}
          AND ${classification} IN (${detailClassList})
          AND categoria_atendimento IS NOT NULL
          AND TRIM(CAST(categoria_atendimento AS STRING)) != ''
        GROUP BY ${classification}, ${category}
        ORDER BY total_cpfs DESC
        LIMIT 50
      `);
      const exampleRows = await runQuery(wh.id, activeOnly ? `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${classification} AS classificacao,
            ${category} AS categoria_atendimento,
            ${caseIdExpr} AS atendimento_id,
            ${idSelectExpr} AS atendimento_label,
            ${subjectSelectExpr} AS assunto,
            LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING))) AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            classificacao,
            categoria_atendimento,
            atendimento_id,
            atendimento_label,
            assunto,
            status_norm,
            data_criacao,
            MIN(data_criacao) OVER (
              PARTITION BY atendimento_id
            ) AS primeira_data,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        scoped AS (
          SELECT
            classificacao,
            COALESCE(NULLIF(TRIM(CAST(categoria_atendimento AS STRING)), ''), 'Sem categoria') AS categoria_atendimento,
            atendimento_label,
            assunto,
            primeira_data,
            data_criacao
          FROM latest_per_case
          WHERE rn = 1
            AND classificacao IN (${detailClassList})
            AND ${openLatestStatusCondition()}
            AND atendimento_label IS NOT NULL
        ),
        ranked AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY classificacao, categoria_atendimento
              ORDER BY data_criacao DESC NULLS LAST, atendimento_label ASC
            ) AS sample_rn
          FROM scoped
        )
        SELECT
          classificacao,
          categoria_atendimento,
          atendimento_label AS atendimento_id,
          assunto,
          DATE_FORMAT(CAST(primeira_data AS TIMESTAMP), 'yyyy-MM-dd') AS data_abertura_primeiro_registro
        FROM ranked
        WHERE sample_rn <= 5
        ORDER BY classificacao ASC, categoria_atendimento ASC, sample_rn ASC
      ` : `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${classification} AS classificacao,
            ${category} AS categoria_atendimento,
            ${idSelectExpr} AS atendimento_id,
            ${subjectSelectExpr} AS assunto,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
            AND ${classification} IN (${detailClassList})
            AND categoria_atendimento IS NOT NULL
            AND TRIM(CAST(categoria_atendimento AS STRING)) != ''
        ),
        latest_by_condition AS (
          SELECT
            cpf_norm,
            classificacao,
            categoria_atendimento,
            atendimento_id,
            assunto,
            data_criacao,
            MIN(data_criacao) OVER (
              PARTITION BY cpf_norm, classificacao, categoria_atendimento
            ) AS primeira_data,
            ROW_NUMBER() OVER (
              PARTITION BY cpf_norm, classificacao, categoria_atendimento
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        ranked AS (
          SELECT
            classificacao,
            categoria_atendimento,
            atendimento_id,
            assunto,
            primeira_data,
            data_criacao,
            ROW_NUMBER() OVER (
              PARTITION BY classificacao, categoria_atendimento
              ORDER BY data_criacao DESC NULLS LAST, atendimento_id ASC
            ) AS sample_rn
          FROM latest_by_condition
          WHERE rn = 1
        )
        SELECT
          classificacao,
          categoria_atendimento,
          atendimento_id,
          assunto,
          DATE_FORMAT(CAST(primeira_data AS TIMESTAMP), 'yyyy-MM-dd') AS data_abertura_primeiro_registro
        FROM ranked
        WHERE sample_rn <= 5
        ORDER BY classificacao ASC, categoria_atendimento ASC, sample_rn ASC
      `);
      const beneficiaryCpfColumn = pickBeneficiaryCpfColumn(beneficiaryColumns);
      const beneficiaryKinshipColumn = pickBeneficiaryKinshipColumn(beneficiaryColumns);
      const typeBreakdownRows = beneficiaryCpfColumn && beneficiaryKinshipColumn ? await runQuery(wh.id, activeOnly ? `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            ${classification} AS classificacao,
            LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING))) AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            classificacao,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        scoped AS (
          SELECT DISTINCT cpf_norm
          FROM latest_per_case
          WHERE rn = 1
            AND classificacao IN (${detailClassList})
            AND ${openLatestStatusCondition()}
        ),
        beneficiary_types AS (
          SELECT
            REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '') AS cpf_norm,
            CASE
              WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.${quoteIdent(beneficiaryKinshipColumn)},''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
              ELSE 'DEPENDENTE'
            END AS tipo
          FROM ${BENEFICIARIES_TABLE} b
          WHERE b.${quoteIdent(beneficiaryCpfColumn)} IS NOT NULL
            AND TRIM(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING)) != ''
          GROUP BY REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '')
        )
        SELECT bt.tipo, COUNT(DISTINCT s.cpf_norm) AS total_cpfs
        FROM scoped s
        INNER JOIN beneficiary_types bt ON bt.cpf_norm = s.cpf_norm
        GROUP BY bt.tipo
      ` : `
        WITH scoped AS (
          SELECT DISTINCT REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
            AND ${classification} IN (${detailClassList})
            AND categoria_atendimento IS NOT NULL
            AND TRIM(CAST(categoria_atendimento AS STRING)) != ''
        ),
        beneficiary_types AS (
          SELECT
            REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '') AS cpf_norm,
            CASE
              WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.${quoteIdent(beneficiaryKinshipColumn)},''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
              ELSE 'DEPENDENTE'
            END AS tipo
          FROM ${BENEFICIARIES_TABLE} b
          WHERE b.${quoteIdent(beneficiaryCpfColumn)} IS NOT NULL
            AND TRIM(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING)) != ''
          GROUP BY REGEXP_REPLACE(CAST(b.${quoteIdent(beneficiaryCpfColumn)} AS STRING), '[^0-9]', '')
        )
        SELECT bt.tipo, COUNT(DISTINCT s.cpf_norm) AS total_cpfs
        FROM scoped s
        INNER JOIN beneficiary_types bt ON bt.cpf_norm = s.cpf_norm
        GROUP BY bt.tipo
      `) : [];
      const examplesByCondition = new Map<string, Array<Record<string, string>>>();
      exampleRows.forEach((row) => {
        const classificacao = String(getCell(row[0]) || '').trim();
        const categoria_atendimento = String(getCell(row[1]) || '').trim();
        const key = `${classificacao}||${categoria_atendimento}`;
        if (!examplesByCondition.has(key)) examplesByCondition.set(key, []);
        examplesByCondition.get(key)!.push({
          id: String(getCell(row[2]) || '').trim(),
          assunto: String(getCell(row[3]) || '').trim() || categoria_atendimento,
          data_abertura_primeiro_registro: String(getCell(row[4]) || '').trim(),
        });
      });
      const items = rows.map((row) => {
        const classificacao = String(getCell(row[0]) || '').trim();
        const categoria_atendimento = String(getCell(row[1]) || '').trim();
        const example_records = examplesByCondition.get(`${classificacao}||${categoria_atendimento}`) || [];
        return {
          classificacao,
          categoria_atendimento,
          total_cpfs: toInt(row[2]),
          example_ids: example_records.map((record) => record.id).filter(Boolean),
          example_records,
        };
      }).filter((item) => item.categoria_atendimento);
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      return res.status(200).json({
        scope: 'care_line_detail',
        classificacao: detailClasses.length === 1 ? detailClasses[0] : 'Múltiplas',
        class_names: detailClasses,
        active_only: activeOnly,
        items,
        total,
        type_breakdown: parseCareTypeBreakdown(typeBreakdownRows),
        id_column: idColumnLabel,
        source: HEALTHCOACH_TABLE,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    if (scope === 'care_bmi_distribution') {
      const classificacao = String(req.query.classificacao || 'Crônico').trim();
      const categoria = String(req.query.categoria || '').trim();
      if (!categoria) return res.status(400).json({ error: "Categoria obrigatória." });
      const activeOnly = String(req.query.active_only || '') === '1';
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const bmiColumn = pickBmiColumn(columns);
      if (!bmiColumn) return res.status(400).json({ error: "Coluna de IMC não encontrada em healthcoach_gold_live." });
      const dateColumn = pickCareDateColumn(columns);
      if (!dateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      const statusColumn = activeOnly ? pickCareStatusColumn(columns) : null;
      if (activeOnly && !statusColumn) return res.status(400).json({ error: "Coluna de status não encontrada em healthcoach_gold_live." });
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId);
      const category = careCategoryExpr();
      const classification = careClassificationExpr();
      const caseIdExpr = careCaseIdExpr(columns);
      const bmiValue = `try_cast(REPLACE(CAST(${quoteIdent(bmiColumn)} AS STRING), ',', '.') AS DOUBLE)`;
      const rows = await runQuery(wh.id, `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            ${classification} AS classificacao,
            ${category} AS categoria_atendimento,
            ${bmiValue} AS imc,
            ${activeOnly ? `LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING)))` : "NULL"} AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
            ${activeOnly ? "" : `AND ${classification} = '${escape(classificacao)}'`}
            ${activeOnly ? "" : `AND ${category} = '${escape(categoria)}'`}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            classificacao,
            categoria_atendimento,
            imc,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        bucketed AS (
          SELECT
            cpf_norm,
            atendimento_id,
            imc,
            CASE
              WHEN imc IS NULL OR imc <= 0 THEN 'Sem IMC válido'
              WHEN imc < 25 THEN 'Até 24,9'
              WHEN imc < 30 THEN '25 a 29,9'
              WHEN imc < 40 THEN '30 a 39,9'
              ELSE '40 ou mais'
            END AS faixa_imc,
            CASE
              WHEN imc IS NULL OR imc <= 0 THEN 5
              WHEN imc < 25 THEN 1
              WHEN imc < 30 THEN 2
              WHEN imc < 40 THEN 3
              ELSE 4
            END AS ordem
          FROM latest_per_case
          WHERE rn = 1
            ${activeOnly ? `AND classificacao = '${escape(classificacao)}' AND categoria_atendimento = '${escape(categoria)}' AND ${openLatestStatusCondition()}` : ""}
        )
        SELECT
          faixa_imc,
          COUNT(DISTINCT cpf_norm) AS total_cpfs,
          ROUND(AVG(imc), 1) AS imc_medio,
          ROUND(MIN(imc), 1) AS imc_minimo,
          ROUND(MAX(imc), 1) AS imc_maximo,
          ordem
        FROM bucketed
        GROUP BY faixa_imc, ordem
        ORDER BY ordem ASC
      `);
      const items = rows.map((row) => ({
        faixa_imc: String(getCell(row[0]) || '').trim(),
        total_cpfs: toInt(row[1]),
        imc_medio: Number(getCell(row[2])) || null,
        imc_minimo: Number(getCell(row[3])) || null,
        imc_maximo: Number(getCell(row[4])) || null,
      })).filter((item) => item.faixa_imc);
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      const missing_bmi_total = items
        .filter((item) => item.faixa_imc === 'Sem IMC válido')
        .reduce((acc, item) => acc + item.total_cpfs, 0);
      const valid_bmi_total = total - missing_bmi_total;
      return res.status(200).json({
        scope: 'care_bmi_distribution',
        classificacao,
        categoria,
        active_only: activeOnly,
        items,
        total,
        valid_bmi_total,
        missing_bmi_total,
        bmi_column: bmiColumn,
        date_column: dateColumn,
        source: HEALTHCOACH_TABLE,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    if (scope === 'care_risk_distribution') {
      const classificacao = String(req.query.classificacao || 'Crônico').trim();
      const categoria = String(req.query.categoria || '').trim();
      if (!categoria) return res.status(400).json({ error: "Categoria obrigatória." });
      const activeOnly = String(req.query.active_only || '') === '1';
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const riskColumn = pickRiskPriorityColumn(columns);
      if (!riskColumn) return res.status(400).json({ error: "Coluna prioridade_atendimento não encontrada em healthcoach_gold_live." });
      const dateColumn = pickCareDateColumn(columns);
      if (!dateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      const statusColumn = activeOnly ? pickCareStatusColumn(columns) : null;
      if (activeOnly && !statusColumn) return res.status(400).json({ error: "Coluna de status não encontrada em healthcoach_gold_live." });
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId);
      const category = careCategoryExpr();
      const classification = careClassificationExpr();
      const caseIdExpr = careCaseIdExpr(columns);
      const riskValue = `LOWER(TRIM(CAST(${quoteIdent(riskColumn)} AS STRING)))`;
      const rows = await runQuery(wh.id, `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            ${classification} AS classificacao,
            ${category} AS categoria_atendimento,
            ${riskValue} AS prioridade,
            ${activeOnly ? `LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING)))` : "NULL"} AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
            ${activeOnly ? "" : `AND ${classification} = '${escape(classificacao)}'`}
            ${activeOnly ? "" : `AND ${category} = '${escape(categoria)}'`}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            classificacao,
            categoria_atendimento,
            prioridade,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        bucketed AS (
          SELECT
            cpf_norm,
            atendimento_id,
            CASE
              WHEN prioridade IN ('baixo', 'baixa', 'risco baixo', 'risco baixa') THEN 'Risco baixo'
              WHEN prioridade IN ('moderado', 'moderada', 'risco moderado', 'risco moderada') THEN 'Risco moderado'
              WHEN prioridade IN ('alto', 'alta', 'risco alto', 'risco alta') THEN 'Risco alto'
              ELSE 'Sem risco informado'
            END AS risco,
            CASE
              WHEN prioridade IN ('baixo', 'baixa', 'risco baixo', 'risco baixa') THEN 1
              WHEN prioridade IN ('moderado', 'moderada', 'risco moderado', 'risco moderada') THEN 2
              WHEN prioridade IN ('alto', 'alta', 'risco alto', 'risco alta') THEN 3
              ELSE 4
            END AS ordem
          FROM latest_per_case
          WHERE rn = 1
            ${activeOnly ? `AND classificacao = '${escape(classificacao)}' AND categoria_atendimento = '${escape(categoria)}' AND ${openLatestStatusCondition()}` : ""}
        )
        SELECT
          risco,
          COUNT(DISTINCT cpf_norm) AS total_cpfs,
          ordem
        FROM bucketed
        GROUP BY risco, ordem
        ORDER BY ordem ASC
      `);
      const items = rows.map((row) => ({
        risco: String(getCell(row[0]) || '').trim(),
        total_cpfs: toInt(row[1]),
      })).filter((item) => item.risco);
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      const missing_risk_total = items
        .filter((item) => item.risco === 'Sem risco informado')
        .reduce((acc, item) => acc + item.total_cpfs, 0);
      return res.status(200).json({
        scope: 'care_risk_distribution',
        classificacao,
        categoria,
        active_only: activeOnly,
        items,
        total,
        risk_total: total - missing_risk_total,
        missing_risk_total,
        risk_column: riskColumn,
        date_column: dateColumn,
        source: HEALTHCOACH_TABLE,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    if (scope === 'care_gestational_distribution') {
      const classificacao = String(req.query.classificacao || 'Situacional').trim();
      const categoria = String(req.query.categoria || 'Gestantes').trim();
      const activeOnly = String(req.query.active_only || '') === '1';
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const weekColumn = pickGestationalWeekColumn(columns);
      if (!weekColumn) return res.status(400).json({ error: "Coluna qual_semana_gestacional não encontrada em healthcoach_gold_live." });
      const dateColumn = pickCareDateColumn(columns);
      if (!dateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      const statusColumn = activeOnly ? pickCareStatusColumn(columns) : null;
      if (activeOnly && !statusColumn) return res.status(400).json({ error: "Coluna de status não encontrada em healthcoach_gold_live." });
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId);
      const category = careCategoryExpr();
      const classification = careClassificationExpr();
      const caseIdExpr = careCaseIdExpr(columns);
      const weekRawExpr = `LOWER(TRIM(CAST(${quoteIdent(weekColumn)} AS STRING)))`;
      const rows = await runQuery(wh.id, `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            ${classification} AS classificacao,
            ${category} AS categoria_atendimento,
            ${weekRawExpr} AS semana_raw,
            try_cast(REGEXP_EXTRACT(${weekRawExpr}, '([0-9]+)', 1) AS INT) AS semana_num,
            ${activeOnly ? `LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING)))` : "NULL"} AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            classificacao,
            categoria_atendimento,
            semana_raw,
            semana_num,
            status_norm,
            data_criacao,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        filtered AS (
          SELECT
            cpf_norm,
            atendimento_id,
            semana_raw,
            semana_num,
            data_criacao,
            CASE
              WHEN data_criacao IS NULL THEN 0
              ELSE GREATEST(CAST(FLOOR(DATEDIFF(current_date(), CAST(data_criacao AS DATE)) / 7) AS INT), 0)
            END AS semanas_passadas
          FROM latest_per_case
          WHERE rn = 1
            AND classificacao = '${escape(classificacao)}'
            AND categoria_atendimento = '${escape(categoria)}'
            ${activeOnly ? `AND ${openLatestStatusCondition()}` : ""}
        ),
        adjusted AS (
          SELECT
            cpf_norm,
            semana_raw,
            data_criacao,
            semanas_passadas,
            CASE
              WHEN semana_raw RLIKE 'puerper' THEN NULL
              WHEN semana_num IS NULL THEN NULL
              ELSE semana_num + semanas_passadas
            END AS semana_atual,
            CASE
              WHEN semana_raw RLIKE 'puerper' THEN 1
              WHEN semana_num IS NULL THEN 0
              ELSE 0
            END AS forca_puerperio
          FROM filtered
        ),
        bucketed AS (
          SELECT
            cpf_norm,
            CASE
              WHEN forca_puerperio = 1 THEN 'Puerpério'
              WHEN semana_atual IS NULL THEN 'Sem semana informada'
              WHEN semana_atual <= 0 THEN 'Sem semana informada'
              WHEN semana_atual BETWEEN 1 AND 13 THEN '1º trimestre (1-13 sem)'
              WHEN semana_atual BETWEEN 14 AND 27 THEN '2º trimestre (14-27 sem)'
              WHEN semana_atual BETWEEN 28 AND 42 THEN '3º trimestre (28-42 sem)'
              ELSE 'Puerpério'
            END AS faixa,
            CASE
              WHEN forca_puerperio = 1 THEN 4
              WHEN semana_atual IS NULL OR semana_atual <= 0 THEN 5
              WHEN semana_atual BETWEEN 1 AND 13 THEN 1
              WHEN semana_atual BETWEEN 14 AND 27 THEN 2
              WHEN semana_atual BETWEEN 28 AND 42 THEN 3
              ELSE 4
            END AS ordem,
            semana_atual
          FROM adjusted
        )
        SELECT
          faixa,
          ordem,
          COUNT(DISTINCT cpf_norm) AS total_cpfs,
          ROUND(AVG(CASE WHEN semana_atual IS NOT NULL AND semana_atual > 0 THEN semana_atual END), 1) AS semana_media,
          MIN(CASE WHEN semana_atual IS NOT NULL AND semana_atual > 0 THEN semana_atual END) AS semana_minima,
          MAX(CASE WHEN semana_atual IS NOT NULL AND semana_atual > 0 THEN semana_atual END) AS semana_maxima
        FROM bucketed
        GROUP BY faixa, ordem
        ORDER BY ordem ASC
      `);
      const items = rows.map((row) => ({
        faixa: String(getCell(row[0]) || '').trim(),
        ordem: toInt(row[1]),
        total_cpfs: toInt(row[2]),
        semana_media: Number(getCell(row[3])) || null,
        semana_minima: Number(getCell(row[4])) || null,
        semana_maxima: Number(getCell(row[5])) || null,
      })).filter((item) => item.faixa);
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      const missing_total = items
        .filter((item) => item.faixa === 'Sem semana informada')
        .reduce((acc, item) => acc + item.total_cpfs, 0);
      const valid_total = total - missing_total;
      return res.status(200).json({
        scope: 'care_gestational_distribution',
        classificacao,
        categoria,
        active_only: activeOnly,
        items,
        total,
        valid_total,
        missing_total,
        week_column: weekColumn,
        date_column: dateColumn,
        reference_date: new Date().toISOString().slice(0, 10),
        source: HEALTHCOACH_TABLE,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    if (scope === 'care_comorbidity_distribution') {
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const dateColumn = pickCareDateColumn(columns);
      if (!dateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      const statusColumn = pickCareStatusColumn(columns);
      if (!statusColumn) return res.status(400).json({ error: "Coluna de status não encontrada em healthcoach_gold_live." });
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId, false);
      const category = careCategoryExpr();
      const classification = careClassificationExpr();
      const caseIdExpr = careCaseIdExpr(columns);
      const classList = ['Crônico', 'Situacional'].map((name) => `'${escape(name)}'`).join(',');
      const rows = await runQuery(wh.id, `
        WITH raw AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            ${classification} AS classificacao,
            NULLIF(TRIM(CAST(${category} AS STRING)), '') AS categoria_atendimento,
            LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING))) AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
        ),
        latest_per_case AS (
          SELECT
            cpf_norm,
            atendimento_id,
            classificacao,
            categoria_atendimento,
            status_norm,
            ROW_NUMBER() OVER (
              PARTITION BY atendimento_id
              ORDER BY data_criacao DESC NULLS LAST
            ) AS rn
          FROM raw
          WHERE atendimento_id IS NOT NULL
        ),
        active_categories AS (
          SELECT DISTINCT
            cpf_norm,
            CONCAT(classificacao, '||', categoria_atendimento) AS category_key
          FROM latest_per_case
          WHERE rn = 1
            AND classificacao IN (${classList})
            AND categoria_atendimento IS NOT NULL
            AND ${openLatestStatusCondition()}
        ),
        cpf_counts AS (
          SELECT
            cpf_norm,
            COUNT(DISTINCT category_key) AS comorbidity_count
          FROM active_categories
          GROUP BY cpf_norm
        ),
        bucketed AS (
          SELECT
            cpf_norm,
            CASE
              WHEN comorbidity_count = 1 THEN '1'
              WHEN comorbidity_count = 2 THEN '2'
              ELSE '3+'
            END AS faixa,
            CASE
              WHEN comorbidity_count = 1 THEN 1
              WHEN comorbidity_count = 2 THEN 2
              ELSE 3
            END AS ordem
          FROM cpf_counts
          WHERE comorbidity_count > 0
        )
        SELECT
          faixa,
          ordem,
          COUNT(DISTINCT cpf_norm) AS total_cpfs
        FROM bucketed
        GROUP BY faixa, ordem
        ORDER BY ordem ASC
      `);
      const items = rows.map((row) => ({
        faixa: String(getCell(row[0]) || '').trim(),
        ordem: toInt(row[1]),
        total_cpfs: toInt(row[2]),
      })).filter((item) => item.faixa);
      const byRange = Object.fromEntries(items.map((item) => [item.faixa, item.total_cpfs]));
      const total = items.reduce((acc, item) => acc + item.total_cpfs, 0);
      return res.status(200).json({
        scope: 'care_comorbidity_distribution',
        items,
        total,
        one_comorbidity: Number(byRange['1']) || 0,
        two_comorbidities: Number(byRange['2']) || 0,
        three_or_more_comorbidities: Number(byRange['3+']) || 0,
        source: HEALTHCOACH_TABLE,
        date_column: dateColumn,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    if (scope === 'care_lines_evolution') {
      const classNames = parseClassNames(req.query);
      if (!classNames.length) return res.status(400).json({ error: "Classificações obrigatórias." });
      const includeOthers = String(req.query.include_others || '') === '1';
      const visibleClasses = includeOthers ? [...classNames, 'Outros'] : classNames;
      const activeOnly = String(req.query.active_only || '') === '1';
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const dateColumn = pickCareDateColumn(columns);
      if (!dateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      const statusColumn = activeOnly ? pickCareStatusColumn(columns) : null;
      if (activeOnly && !statusColumn) return res.status(400).json({ error: "Coluna de status não encontrada em healthcoach_gold_live." });
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId, false);
      const classification = careClassificationExpr();
      const caseIdExpr = careCaseIdExpr(columns);
      const classList = classNames.map((name) => `'${escape(name)}'`).join(',');
      const rows = await runQuery(wh.id, `
        WITH base AS (
          SELECT
            DATE_FORMAT(try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP), 'yyyy-MM') AS mes,
            ${classification} AS classificacao,
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            ${caseIdExpr} AS atendimento_id,
            ${activeOnly ? `LOWER(TRIM(CAST(${quoteIdent(statusColumn)} AS STRING)))` : "NULL"} AS status_norm,
            try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) AS data_criacao
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
            AND try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP) IS NOT NULL
        ),
        latest_month AS (
          SELECT MAX(mes) AS mes FROM base
        ),
        months AS (
          SELECT DATE_FORMAT(add_months(to_date(CONCAT(mes, '-01')), -2), 'yyyy-MM') AS mes FROM latest_month
          UNION ALL
          SELECT DATE_FORMAT(add_months(to_date(CONCAT(mes, '-01')), -1), 'yyyy-MM') AS mes FROM latest_month
          UNION ALL
          SELECT mes FROM latest_month
        ),
        classes AS (
          ${literalRows(visibleClasses, 'classificacao')}
        ),
        active_base AS (
          SELECT mes, classificacao, cpf_norm
          FROM (
            SELECT
              b.*,
              ROW_NUMBER() OVER (
                PARTITION BY b.mes, b.atendimento_id
                ORDER BY b.data_criacao DESC NULLS LAST
              ) AS rn
            FROM base b
            WHERE b.atendimento_id IS NOT NULL
          )
          WHERE rn = 1
            AND ${openLatestStatusCondition()}
        ),
        scoped AS (
          SELECT
            b.mes,
            CASE
              WHEN b.classificacao IN (${classList}) THEN b.classificacao
              ${includeOthers ? "ELSE 'Outros'" : "ELSE NULL"}
            END AS classificacao,
            b.cpf_norm
          FROM ${activeOnly ? "active_base" : "base"} b
          INNER JOIN months m ON m.mes = b.mes
        )
        SELECT
          m.mes,
          c.classificacao,
          COUNT(DISTINCT s.cpf_norm) AS total_cpfs
        FROM months m
        CROSS JOIN classes c
        LEFT JOIN scoped s
          ON s.mes = m.mes
         AND s.classificacao = c.classificacao
        WHERE m.mes IS NOT NULL
        GROUP BY m.mes, c.classificacao
        ORDER BY m.mes ASC, c.classificacao ASC
      `);
      const months = [...new Set(rows.map((row) => String(getCell(row[0]) || '').trim()).filter(Boolean))];
      const seriesByClass = new Map<string, Record<string, number>>();
      rows.forEach((row) => {
        const month = String(getCell(row[0]) || '').trim();
        const classificacao = String(getCell(row[1]) || '').trim();
        if (!month || !classificacao) return;
        if (!seriesByClass.has(classificacao)) seriesByClass.set(classificacao, {});
        seriesByClass.get(classificacao)![month] = toInt(row[2]);
      });
      const series = visibleClasses.map((classificacao) => ({
        classificacao,
        values: months.map((month) => seriesByClass.get(classificacao)?.[month] || 0),
      }));
      return res.status(200).json({
        scope: 'care_lines_evolution',
        months,
        series,
        active_only: activeOnly,
        source: HEALTHCOACH_TABLE,
        date_column: dateColumn,
        auth_role: getDashboardAuth(req)?.role || 'full',
        updatedAt: new Date().toISOString(),
      });
    }

    if (scope === 'care_new_beneficiaries') {
      const [columns, beneficiaryColumns] = await Promise.all([
        getColumns(wh.id, HEALTHCOACH_TABLE),
        getColumns(wh.id, BENEFICIARIES_TABLE).catch(() => []),
      ]);
      const dateColumn = pickCareDateColumn(columns);
      if (!dateColumn) return res.status(400).json({ error: "Coluna de data não encontrada em healthcoach_gold_live." });
      const company = req.query.company || null;
      const baseWhere = buildCareLineFilters(columns, beneficiaryColumns, req.query, groupNames, company, partnerBrokerId, false);
      const meses = req.query.meses ? String(req.query.meses).split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
      const firstDateFilter = meses.length
        ? `WHERE DATE_FORMAT(primeira_data, 'yyyy-MM') IN (${meses.map((month) => `'${escape(month)}'`).join(',')})`
        : '';
      const rows = await runQuery(wh.id, `
        WITH primeiro_atendimento AS (
          SELECT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm,
            MIN(try_cast(${quoteIdent(dateColumn)} AS TIMESTAMP)) AS primeira_data
          FROM ${HEALTHCOACH_TABLE}
          WHERE cpf_atendido IS NOT NULL
            AND TRIM(CAST(cpf_atendido AS STRING)) != ''
          GROUP BY REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '')
        ),
        cpfs_filtrados AS (
          SELECT DISTINCT
            REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', '') AS cpf_norm
          FROM ${HEALTHCOACH_TABLE}
          WHERE ${baseWhere}
        ),
        novos AS (
          SELECT pa.cpf_norm
          FROM primeiro_atendimento pa
          INNER JOIN cpfs_filtrados cf
            ON cf.cpf_norm = pa.cpf_norm
          ${firstDateFilter}
        )
        SELECT COUNT(DISTINCT cpf_norm) AS novos_cpfs
        FROM novos
      `);
      return res.status(200).json({
        scope: 'care_new_beneficiaries',
        total_new_beneficiaries: toInt(rows[0]?.[0]),
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
          UNION ALL
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
