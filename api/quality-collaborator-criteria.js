// api/quality-collaborator-criteria.js
// Detalhe sob demanda das notas por critério para um colaborador.

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const CRITERIA_TABLE = "sanus_databricks.sanus_prod.quality_analysis_silver_criteria";
const CRITERION_MAX_SCORE = 2;

const DATE_CANDIDATES = ["event_timestamp", "created_at", "creation_time", "data_criacao", "created_date", "timestamp"];
const CRITERION_ID_CANDIDATES = ["criterio_id", "criterion_id", "codigo_criterio", "id_criterio"];
const CRITERIA_SCORE_CANDIDATES = ["pontuacao", "score", "nota", "value", "criterion_score", "score_value", "nota_criterio"];
const APPLICABLE_CANDIDATES = ["is_applicable", "applicable", "aplicavel", "aplicável"];
const ATTENDANCE_CANDIDATES = ["attendance_id", "atendimento_id", "appointment_id"];
const CRITERIA_COLLABORATOR_CANDIDATES = [
  "close_by", "close by", "closed_by", "closed by", "closeby", "closedby",
  "colaborador", "nome_colaborador", "responsavel", "operator_name", "user_name",
];
const MISSING_COLLABORATOR_LABEL = "Sem close_by preenchido";

async function dbFetch(path, options = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId, sql) {
  let data = await dbFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement: sql,
      wait_timeout: "50s",
      on_wait_timeout: "CONTINUE",
    }),
  });
  let { statement_id: sid, status: { state } } = data;
  while (state === "PENDING" || state === "RUNNING") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    data = await dbFetch(`/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || `Query falhou: ${state}`);
  return data.result?.data_array || [];
}

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (value) => {
  const number = parseInt(getCell(value), 10);
  return Number.isFinite(number) ? number : 0;
};
const toNumber = (value) => {
  const raw = getCell(value);
  if (raw === null || raw === undefined || raw === "") return null;
  const number = Number(String(raw).replace(",", "."));
  return Number.isFinite(number) ? number : null;
};
const escapeSql = (value) => String(value).replace(/'/g, "''");
const quoteIdent = (value) => `\`${String(value).replace(/`/g, "``")}\``;
const qcol = (alias, column) => `${alias}.${quoteIdent(column)}`;

async function getColumns(warehouseId, tableName) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || "").trim())
    .filter((column) => column && !column.startsWith("#"));
}

function pickColumn(columns, candidates) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const exact = byLower.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const fuzzy = columns.find((column) => column.toLowerCase().replace(/[^a-z0-9]+/g, "") === needle);
    if (fuzzy) return fuzzy;
  }
  return null;
}

function numberExpr(alias, column) {
  if (!column) return "CAST(NULL AS DOUBLE)";
  return `try_cast(regexp_replace(regexp_replace(CAST(${qcol(alias, column)} AS STRING), ',', '.'), '[^0-9.-]', '') AS DOUBLE)`;
}

function applicableCondition(alias, column) {
  if (!column) return "1=1";
  const expr = `LOWER(TRIM(CAST(${qcol(alias, column)} AS STRING)))`;
  return `${expr} IN ('true','1','sim','yes','y')`;
}

function collaboratorExpr(alias, column) {
  return `COALESCE(NULLIF(TRIM(CAST(${qcol(alias, column)} AS STRING)), ''), '${MISSING_COLLABORATOR_LABEL}')`;
}

function buildWhere({ meses, collaborator, missingCollaborator, dateColumn, applicableColumn, collaboratorColumn }) {
  const conditions = [applicableCondition("q", applicableColumn)];
  if (meses.length && dateColumn) {
    conditions.push(`DATE_FORMAT(try_cast(${qcol("q", dateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((mes) => `'${escapeSql(mes)}'`).join(",")})`);
  }
  const selectedCollaborator = missingCollaborator ? MISSING_COLLABORATOR_LABEL : collaborator;
  conditions.push(`${collaboratorExpr("q", collaboratorColumn)} = '${escapeSql(selectedCollaborator)}'`);
  return conditions.join(" AND ");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();

  const collaborator = String(req.query.collaborator || "").trim();
  const missingCollaborator = String(req.query.missing_close_by || "") === "1";
  const meses = req.query.meses ? String(req.query.meses).split(",").filter((mes) => /^\d{4}-\d{2}$/.test(mes)) : [];
  if (!collaborator && !missingCollaborator) {
    return res.status(400).json({ error: "Colaborador inválido." });
  }

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const warehouse = warehouses.find((item) => item.state === "RUNNING") || warehouses[0];
    if (!warehouse) throw new Error("Nenhum SQL Warehouse disponível.");

    const columns = await getColumns(warehouse.id, CRITERIA_TABLE);
    const dateColumn = pickColumn(columns, DATE_CANDIDATES);
    const criterionColumn = pickColumn(columns, CRITERION_ID_CANDIDATES);
    const scoreColumn = pickColumn(columns, CRITERIA_SCORE_CANDIDATES);
    const applicableColumn = pickColumn(columns, APPLICABLE_CANDIDATES);
    const attendanceColumn = pickColumn(columns, ATTENDANCE_CANDIDATES);
    const collaboratorColumn = pickColumn(columns, CRITERIA_COLLABORATOR_CANDIDATES);
    if (!criterionColumn || !scoreColumn || !collaboratorColumn) {
      throw new Error(`Colunas necessárias não encontradas. criterio=${criterionColumn || "n/a"} pontuacao=${scoreColumn || "n/a"} close_by=${collaboratorColumn || "n/a"}`);
    }

    const where = buildWhere({ meses, collaborator, missingCollaborator, dateColumn, applicableColumn, collaboratorColumn });
    const criterionGroupExpr = `COALESCE(NULLIF(regexp_extract(regexp_replace(CAST(${qcol("q", criterionColumn)} AS STRING), ',', '.'), '^(\\\\d+)', 1), ''), CAST(${qcol("q", criterionColumn)} AS STRING))`;
    const rows = await runQuery(warehouse.id, `
      SELECT
        ${criterionGroupExpr} AS criterion_id,
        ${attendanceColumn ? `COUNT(DISTINCT CAST(${qcol("q", attendanceColumn)} AS STRING))` : "COUNT(*)"} AS total_atendimentos,
        COUNT(*) AS total_avaliacoes,
        AVG(${numberExpr("q", scoreColumn)}) AS pontuacao_media,
        COALESCE(SUM(COALESCE(${numberExpr("q", scoreColumn)}, 0)), 0) / NULLIF(COUNT(*) * ${CRITERION_MAX_SCORE}, 0) * 100 AS score_pct
      FROM ${CRITERIA_TABLE} q
      WHERE ${where}
      GROUP BY ${criterionGroupExpr}
      ORDER BY criterion_id
    `);

    res.status(200).json({
      collaborator: missingCollaborator ? MISSING_COLLABORATOR_LABEL : collaborator,
      items: rows.map((row) => ({
        criterion_id: String(getCell(row[0]) || "Critério"),
        total_atendimentos: toInt(row[1]),
        total_avaliacoes: toInt(row[2]),
        pontuacao_media: toNumber(row[3]),
        score_pct: toNumber(row[4]),
      })),
      filters: { meses, missing_close_by: missingCollaborator },
      schema: { dateColumn, criterionColumn, scoreColumn, applicableColumn, attendanceColumn, collaboratorColumn },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
