declare const process: { env: Record<string, string | undefined> };

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

export type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
export type DatabricksRow = DatabricksCell[];

type DbOptions = RequestInit & { headers?: Record<string, string> };

let warehouseIdCache: string | null = null;
const columnsCache = new Map<string, string[]>();

export async function dbFetch(path: string, options: DbOptions = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function runQuery(warehouseId: string, sql: string): Promise<DatabricksRow[]> {
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

export async function resolveWarehouseId(): Promise<string> {
  const fromEnv = process.env.DATABRICKS_WAREHOUSE_ID?.trim();
  if (fromEnv) return fromEnv;
  if (warehouseIdCache) return warehouseIdCache;

  const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: { id: string; state?: string }[] };
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
  if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");
  warehouseIdCache = wh.id;
  return wh.id;
}

export async function getColumns(warehouseId: string, tableName: string): Promise<string[]> {
  const cached = columnsCache.get(tableName);
  if (cached) return cached;

  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  const columns = rows
    .map((row) => String(getCell(row[0]) || "").trim())
    .filter((column) => column && !column.startsWith("#"));
  columnsCache.set(tableName, columns);
  return columns;
}

export function getCell(cell: DatabricksCell) {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
}

export const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };
export const toNum = (v: DatabricksCell) => { const n = parseFloat(String(getCell(v))); return Number.isFinite(n) ? n : 0; };
export const toFloat = (v: DatabricksCell) => toNum(v);
export const escape = (s: unknown) => String(s).replace(/'/g, "''");
export const quoteIdent = (s: unknown) => `\`${String(s).replace(/`/g, "``")}\``;
