// api/appointments-evolution.js
// Evolução mensal de agendamentos na atendimento_gold_live.

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const APPOINTMENTS_TABLE = `sanus_databricks.sanus_prod.atendimento_gold_live`;
const APPOINTMENTS_DATE_COLUMN = 'hora_criacao_atendimento';

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
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

async function getColumns(warehouseId, tableName) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || '').trim())
    .filter((column) => column && !column.startsWith('#'));
}

function lastNMonthsList(n) {
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const meses = req.query.meses ? req.query.meses.split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const monthList = meses.length ? meses.sort() : lastNMonthsList(Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24));
  const monthInList = `(${monthList.map((m) => `'${m}'`).join(',')})`;
  const monthExpr = `DATE_FORMAT(${quoteIdent(APPOINTMENTS_DATE_COLUMN)}, 'yyyy-MM')`;
  const groupFilter = groupName
    ? `AND grupo_economico LIKE '%${escape(groupName)}'`
    : '';

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    let companyColumn = null;
    if (company) {
      const columns = await getColumns(wh.id, APPOINTMENTS_TABLE);
      companyColumn = pickColumn(columns, [
        'NOME_CLIENTE',
        'nome_cliente',
        'empresa',
        'Empresa',
        'nome_empresa',
        'NOME_EMPRESA',
        'company',
        'company_name',
      ]);
    }
    const companyFilter = company && companyColumn
      ? `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) = UPPER(TRIM('${escape(company)}'))`
      : '';

    const rows = await runQuery(wh.id, `
      SELECT
        ${monthExpr} AS mes,
        COUNT(*) AS total
      FROM ${APPOINTMENTS_TABLE}
      WHERE motivo = 'Concluído com sucesso'
        AND UPPER(TRIM(COALESCE(motivo, ''))) NOT IN (
          'ATENDIMENTO WHATSAPP',
          'ATENDIMENTO HUMANO',
          'FORA DO HORARIO DE ATEDIMENTO'
        )
        AND UPPER(assunto) NOT IN (
          'ATENDIMENTO WHATSAPP',
          'ATENDIMENTO HUMANO',
          'FORA DE HORÁRIO DE ATENDIMENTO'
        )
        AND ${monthExpr} IN ${monthInList}
        ${groupFilter}
        ${companyFilter}
      GROUP BY ${monthExpr}
      ORDER BY mes
    `);

    const byMes = Object.fromEntries(rows.map((r) => [String(getCell(r[0]) || ''), toInt(r[1])]));
    const series = monthList.map((m) => ({ mes: m, total: byMes[m] || 0 }));

    res.status(200).json({
      months: monthList,
      series,
      source: "atendimento_gold_live.hora_criacao_atendimento",
      filters: { group_name: groupName, company },
      company_column: companyColumn,
      company_filter_applied: !company || Boolean(companyColumn),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
