// api/sessions-by-company.js
// Quadro "Humano vs IA por empresa" — versão isolada para validar a lógica.
// Por enquanto roda APENAS um mês (default = mês anterior; aceita ?mes=YYYY-MM).
// Respeita filtros de grupo econômico, empresa e tipo de beneficiário.

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const VW_BENEFICIARIOS = `sanus_databricks.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `sanus_databricks.sanus_prod.organizations`;

async function dbFetch(path, options = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId, sql) {
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

const escape = (s) => String(s).replace(/'/g, "''");
const quoteIdent = (s) => `\`${String(s).replace(/`/g, "``")}\``;

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };

function pickColumn(columns, candidates) {
  const byLower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const col = byLower.get(cand.toLowerCase());
    if (col) return col;
  }
  return null;
}

async function getColumns(warehouseId, tableName) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || '').trim())
    .filter((c) => c && !c.startsWith('#'));
}

function normalizeCpfExpr(expr) {
  const digits = `NULLIF(regexp_replace(TRIM(CAST(${expr} AS STRING)), '[^0-9]', ''), '')`;
  return `CASE
    WHEN ${digits} IS NULL THEN NULL
    WHEN LENGTH(${digits}) < 11 THEN LPAD(${digits}, 11, '0')
    ELSE ${digits}
  END`;
}

function jsonValueExpr(variablesColumn, keys) {
  const variables = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  const expressions = keys.flatMap((key) => [
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}')), '')`,
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}.value')), '')`,
  ]);
  return `COALESCE(${expressions.join(', ')})`;
}

function sessionCpfExpr(variablesColumn) {
  if (!variablesColumn) return null;
  const jsonCpf = jsonValueExpr(variablesColumn, [
    'inputcpfholder', 'cpf_holder', 'cpf',
  ]);
  return normalizeCpfExpr(jsonCpf);
}

function variablesPrefilter(variablesColumn) {
  const v = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  return `${v} IS NOT NULL AND (
    ${v} LIKE '%inputcpfholder%' OR
    ${v} LIKE '%cpf_holder%' OR
    ${v} LIKE '%"cpf"%' OR
    ${v} LIKE '%"CPF"%'
  )`;
}

function buildBeneficiaryFilter(groupName, company, typeFilter) {
  const conditions = [];
  if (groupName) {
    const g = escape(groupName);
    conditions.push(`b.ID_EMPRESA IN (
      SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
      UNION
      SELECT id FROM ${ORGANIZATIONS_TABLE}
      WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
    )`);
  }
  if (company) {
    const c = escape(company);
    conditions.push(`b.ID_EMPRESA IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${c}')`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) != 'TITULAR'`);
  }
  return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
}

function previousMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typeFilter = req.query.type || null;
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : previousMonth();
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const [sessionColumns, beneficiaryViewColumns] = await Promise.all([
      getColumns(wh.id, SESSION_TABLE),
      getColumns(wh.id, VW_BENEFICIARIOS),
    ]);

    const sessionDateColumn = pickColumn(sessionColumns, [
      'created_at', 'createdAt', 'creation_time', 'creationTime',
      'created_time', 'createdTime', 'session_created_at', 'session_creation_time',
      'started_at', 'start_time', 'startTime',
      'last_message_at', 'lastMessageAt', 'last_interaction_at', 'lastInteractionAt',
      'updated_at', 'timestamp', 'data_criacao',
    ]);
    const variablesColumn = pickColumn(sessionColumns, ['variables']);
    const beneficiaryCpfColumn = pickColumn(beneficiaryViewColumns, [
      'cpf', 'CPF', 'cpf_beneficiario', 'CPF_BENEFICIARIO',
      'document', 'DOCUMENT', 'documento', 'DOCUMENTO',
      'document_number', 'DOCUMENT_NUMBER', 'cpf_holder', 'CPF_HOLDER',
    ]);

    if (!sessionDateColumn) throw new Error("Coluna de data não encontrada em botmaker_session.");
    if (!variablesColumn)   throw new Error("Coluna 'variables' não encontrada em botmaker_session.");
    if (!beneficiaryCpfColumn) throw new Error("Coluna de CPF não encontrada em vw_beneficiarios.");

    const sessionDateFilter = `DATE_FORMAT(try_cast(${quoteIdent(sessionDateColumn)} AS TIMESTAMP), 'yyyy-MM') = '${mes}'`;
    const sessionCpfFilterExpr = sessionCpfExpr(variablesColumn);
    const sessionVariablesFilter = variablesPrefilter(variablesColumn);
    const extraFilter = buildBeneficiaryFilter(groupName, company, typeFilter);

    const sql = `
      WITH filtered_benef AS (
        SELECT DISTINCT
          b.NOME_CLIENTE AS empresa,
          ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} AS cpf
        FROM ${VW_BENEFICIARIOS} b
        WHERE NOME_CLIENTE IS NOT NULL
          ${extraFilter}
          AND ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} IS NOT NULL
      ),
      sessions_filtered AS (
        SELECT finished_by, ${quoteIdent(variablesColumn)} AS variables
        FROM ${SESSION_TABLE}
        WHERE ${sessionDateFilter}
          AND ${sessionVariablesFilter}
      ),
      sessions_resolved AS (
        SELECT finished_by, ${sessionCpfFilterExpr} AS cpf
        FROM sessions_filtered
      )
      SELECT /*+ BROADCAST(fb) */
        fb.empresa AS empresa,
        SUM(CASE WHEN s.finished_by IS NOT NULL THEN 1 ELSE 0 END) AS humano,
        SUM(CASE WHEN s.finished_by IS NULL     THEN 1 ELSE 0 END) AS ia
      FROM sessions_resolved s
      INNER JOIN filtered_benef fb ON fb.cpf = s.cpf
      WHERE s.cpf IS NOT NULL
      GROUP BY fb.empresa
      ORDER BY (SUM(CASE WHEN s.finished_by IS NOT NULL THEN 1 ELSE 0 END)
              + SUM(CASE WHEN s.finished_by IS NULL     THEN 1 ELSE 0 END)) DESC
      LIMIT ${limit}
    `;

    const rows = await runQuery(wh.id, sql);
    const items = rows
      .map((r) => {
        const humano = toInt(r[1]);
        const ia = toInt(r[2]);
        return {
          empresa: String(getCell(r[0]) || "—").trim(),
          humano,
          ia,
          total: humano + ia,
        };
      })
      .filter((it) => it.total > 0);

    const totalHumano = items.reduce((acc, it) => acc + it.humano, 0);
    const totalIa = items.reduce((acc, it) => acc + it.ia, 0);

    res.status(200).json({
      mes,
      filters: { group_name: groupName, company, type: typeFilter },
      items,
      total_humano: totalHumano,
      total_ia: totalIa,
      total: totalHumano + totalIa,
      empresas: items.length,
      source: "botmaker_session.finished_by JOIN vw_beneficiarios via CPF",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
