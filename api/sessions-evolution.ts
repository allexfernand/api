// api/sessions-evolution.ts
// Evolução mensal de sessões finalizadas por Humano e IA (últimos 12 meses).
// - Sem filtro de grupo/empresa: COUNT(*) GROUP BY mês — query rápida.
// - Com filtro: JOIN por botmaker_session.organization_id x organizations.id.
// Aceita ?group_name=, ?company=, ?type=, ?months=12.
declare const process: { env: Record<string, string | undefined> };

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const SESSION_TABLE       = `hive_metastore.sanus_prod.botmaker_session`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;

const SESSION_DATE_COLUMN = 'creation_time';

type DbOptions = RequestInit & { headers?: Record<string, string> };
type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
type DatabricksRow = DatabricksCell[];
type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};
type Warehouse = { id: string; state?: string };

async function dbFetch(path: string, options: DbOptions = {}) {
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

const escape = (s: unknown) => String(s).replace(/'/g, "''");
const quoteIdent = (s: unknown) => `\`${String(s).replace(/`/g, "``")}\``;

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };

function pickColumn(columns: string[], candidates: string[]) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

async function getColumns(warehouseId: string, tableName: string) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || '').trim())
    .filter((column) => column && !column.startsWith('#'));
}

function uniqueBeneficiaryExpr(columns: string[]) {
  const directCpfColumn = pickColumn(columns, [
    'cpf', 'CPF', 'document', 'documento', 'cpf_cnpj', 'cpfCnpj',
    'document_number', 'numero_documento', 'beneficiary_cpf', 'beneficiario_cpf',
    'cpf_beneficiario', 'cpf_beneficiary', 'cpf_titular',
  ]);
  const directBeneficiaryColumn = pickColumn(columns, [
    'beneficiary_id', 'beneficiario_id', 'id_beneficiario', 'idBeneficiario',
    'beneficiaryId', 'user_id', 'userId', 'customer_id', 'customerId',
    'patient_id', 'patientId', 'member_id', 'memberId', 'health_user_id',
  ]);
  const cpfExpressions = [];
  const idExpressions = [];
  if (directCpfColumn) {
    cpfExpressions.push(`CAST(s.${quoteIdent(directCpfColumn)} AS STRING)`);
  }
  if (directBeneficiaryColumn) {
    idExpressions.push(`CAST(s.${quoteIdent(directBeneficiaryColumn)} AS STRING)`);
  }
  if (columns.some((column) => column.toLowerCase() === 'variables')) {
    cpfExpressions.push(
      `CAST(s.${quoteIdent('variables')}['cpf'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['CPF'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['document'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['documento'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['cpf_cnpj'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['document_number'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['beneficiary_cpf'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['cpf_beneficiario'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['cpf_beneficiary'] AS STRING)`
    );
    idExpressions.push(
      `CAST(s.${quoteIdent('variables')}['beneficiary_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['beneficiaryId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['beneficiario_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['id_beneficiario'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['idBeneficiario'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['user_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['userId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['customer_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['customerId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['patient_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['patientId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['member_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['memberId'] AS STRING)`
    );
  }
  if (!cpfExpressions.length && !idExpressions.length) return null;
  const cpfExpr = cpfExpressions.length
    ? `NULLIF(regexp_replace(COALESCE(${cpfExpressions.join(', ')}), '[^0-9]', ''), '')`
    : "CAST(NULL AS STRING)";
  const idExpr = idExpressions.length
    ? `NULLIF(TRIM(CAST(COALESCE(${idExpressions.join(', ')}) AS STRING)), '')`
    : "CAST(NULL AS STRING)";
  return `COALESCE(CASE WHEN ${cpfExpr} IS NOT NULL THEN CONCAT('cpf:', ${cpfExpr}) END, CASE WHEN ${idExpr} IS NOT NULL THEN CONCAT('beneficiary:', ${idExpr}) END)`;
}

function orgIdsSubquery(groupName: unknown, company: unknown) {
  if (company) {
    return `(SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${escape(company)}')`;
  }
  const g = escape(groupName);
  return `(
    SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
    UNION
    SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
  )`;
}

function lastNMonthsList(n: number) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setUTCMonth(d.getUTCMonth() - i);
    const y = dd.getUTCFullYear();
    const m = String(dd.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
  }
  return out;
}

function nextMonth(month: string) {
  const [year, mm] = month.split('-').map((value) => parseInt(value, 10));
  const d = new Date(Date.UTC(year, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typeFilter = req.query.type || null;
  const granularity = req.query.granularity || 'month';
  const dayMonth = req.query.mes && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : null;
  const months = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24);
  const hasOrgFilter = Boolean(groupName || company);

  const monthList = lastNMonthsList(months);
  const monthInList = `(${monthList.map((m) => `'${m}'`).join(',')})`;
  const sessionDateExpr = `try_cast(s.${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP)`;
  const monthsSqlFilter = `DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM') IN ${monthInList}`;
  const selectedDayMonth = dayMonth || monthList[monthList.length - 1];
  const daySqlFilter = `${sessionDateExpr} >= '${selectedDayMonth}-01'
    AND ${sessionDateExpr} < '${nextMonth(selectedDayMonth)}-01'`;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");
    const sessionColumns = await getColumns(wh.id, SESSION_TABLE);
    const beneficiaryExpr = uniqueBeneficiaryExpr(sessionColumns);

    const filters = [granularity === 'day' ? daySqlFilter : monthsSqlFilter];
    if (hasOrgFilter) {
      filters.push(`CAST(o.${quoteIdent('id')} AS STRING) IN ${orgIdsSubquery(groupName, company)}`);
    }
    const fromSql = hasOrgFilter
      ? `${SESSION_TABLE} s
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)`
      : `${SESSION_TABLE} s`;
    const where = `WHERE ${filters.join(' AND ')}`;
    const mode = hasOrgFilter ? "organization_join" : "global";
    if (granularity === 'day') {
      const rows = await runQuery(wh.id, `
        SELECT
          DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM-dd') AS dia,
          CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
          COUNT(*) AS total
        FROM ${fromSql}
        ${where}
        GROUP BY
          DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM-dd'),
          CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
        ORDER BY dia
      `);

      const byDiaTipo = new Map(rows.map((r) => [
        `${String(getCell(r[0]) || '')}|${String(getCell(r[1]) || '').toUpperCase()}`,
        toInt(r[2]),
      ]));
      const days = [];
      const start = new Date(`${selectedDayMonth}-01T00:00:00Z`);
      const end = new Date(`${nextMonth(selectedDayMonth)}-01T00:00:00Z`);
      for (const d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
      }
      const series = days.map((day) => {
        const humano = byDiaTipo.get(`${day}|HUMANO`) || 0;
        const ia = byDiaTipo.get(`${day}|IA`) || 0;
        return { dia: day, humano, ia, total: humano + ia };
      });

      return res.status(200).json({
        granularity: "day",
        month: selectedDayMonth,
        series,
        filters: { group_name: groupName, company, type: typeFilter },
        mode,
        source: "botmaker_session.creation_time",
      });
    }

    const [rows, beneficiaryRows] = await Promise.all([
      runQuery(wh.id, `
      SELECT
        DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM') AS mes,
        CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
        COUNT(*) AS total
      FROM ${fromSql}
      ${where}
      GROUP BY
        DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM'),
        CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
      ORDER BY mes
    `),
      beneficiaryExpr ? runQuery(wh.id, `
      SELECT
        DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM') AS mes,
        COUNT(DISTINCT ${beneficiaryExpr}) AS unique_beneficiaries
      FROM ${fromSql}
      ${where}
        AND ${beneficiaryExpr} IS NOT NULL
      GROUP BY DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM')
      ORDER BY mes
    `) : Promise.resolve([]),
    ]);

    const byMesTipo = new Map(rows.map((r) => [
      `${String(getCell(r[0]) || '')}|${String(getCell(r[1]) || '').toUpperCase()}`,
      toInt(r[2]),
    ]));
    const beneficiariesByMes = new Map(beneficiaryRows.map((r) => [String(getCell(r[0]) || ''), toInt(r[1])]));
    const series = monthList.map((m) => {
      const humano = byMesTipo.get(`${m}|HUMANO`) || 0;
      const ia = byMesTipo.get(`${m}|IA`) || 0;
      const uniqueBeneficiaries = beneficiariesByMes.get(m) || 0;
      return { mes: m, humano, ia, total: humano + ia, unique_cpfs: uniqueBeneficiaries, unique_beneficiaries: uniqueBeneficiaries };
    });

    res.status(200).json({
      months,
      series,
      filters: { group_name: groupName, company, type: typeFilter },
      mode,
      source: "botmaker_session.creation_time",
      cpf_source: beneficiaryExpr ? "botmaker_session.cpf/beneficiary_id/variables" : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
