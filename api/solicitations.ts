// api/solicitations.ts
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

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt   = (v: DatabricksCell) => { const n = parseInt(String(getCell(v)));   return Number.isFinite(n) ? n : 0; };
const toFloat = (v: DatabricksCell) => { const n = parseFloat(String(getCell(v))); return Number.isFinite(n) ? n : 0; };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const meses     = req.query.meses ? req.query.meses.split(',').filter((m: string) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupName = req.query.group_name || null;

  const periodoFilter = meses.length > 0
    ? `AND DATE_FORMAT(hora_criacao_atendimento, 'yyyy-MM') IN (${meses.map((m: string) => `'${m}'`).join(',')})`
    : '';

  const groupFilter = groupName
    ? `AND grupo_economico LIKE '%${groupName.replace(/'/g, "''")}'`
    : '';

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const rows = await runQuery(wh.id, `
      SELECT
        CASE
          WHEN tipo_solicitacao IS NULL THEN 'Nulo'
          WHEN tipo_solicitacao IN ('Consulta', 'Médico') THEN 'Consulta'
          WHEN tipo_solicitacao IN ('Exame', 'Exames') THEN 'Exame'
          WHEN tipo_solicitacao IN ('Fisioterapia', 'Fonoterapia', 'Terapia Ocupacional') THEN 'Terapia'
          ELSE 'Outros'
        END AS tipo_agrupado,
        COUNT(*) AS quantidade
      FROM hive_metastore.sanus_prod.atendimento_gold_live
      WHERE motivo IN ('Concluído com sucesso', 'Concluído com sucesso pela DASA')
        ${periodoFilter}
        ${groupFilter}
      GROUP BY tipo_agrupado
      ORDER BY quantidade DESC
    `);

    const total = rows.reduce((acc, r) => acc + toInt(r[1]), 0);
    const items = rows.map(r => ({
      tipo: String(getCell(r[0]) || 'Outros'),
      quantidade: toInt(r[1]),
      percentual: total > 0 ? Math.round((toInt(r[1]) / total) * 1000) / 10 : 0,
    }));

    res.status(200).json({ items, total });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
