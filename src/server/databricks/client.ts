declare const process: { env: Record<string, string | undefined> };
import { logger } from "../observability/logger";

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

export type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
export type DatabricksRow = DatabricksCell[];

export type SqlParameter = { name: string; value: string; type?: string };

// Coletor de parâmetros nomeados para a Statement Execution API: cada valor
// vira um marcador ":pN" no SQL e é enviado como parâmetro tipado, nunca
// concatenado como literal — elimina SQL injection por construção. A API
// aceita parâmetros declarados que não aparecem no statement, então a mesma
// lista pode ser compartilhada por várias queries de um mesmo handler.
export function createSqlParams() {
  const list: SqlParameter[] = [];
  const add = (value: unknown): string => {
    const name = `p${list.length}`;
    list.push({ name, value: String(value) });
    return `:${name}`;
  };
  const addAll = (values: unknown[]): string => values.map((value) => add(value)).join(", ");
  return { list, add, addAll };
}
export type SqlParams = ReturnType<typeof createSqlParams>;

type DbOptions = RequestInit & { headers?: Record<string, string> };

let warehouseIdCache: string | null = null;
const columnsCache = new Map<string, string[]>();

export async function dbFetch(path: string, options: DbOptions = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function runQuery(
  warehouseId: string,
  sql: string,
  parameters?: SqlParameter[],
): Promise<DatabricksRow[]> {
  const startedAt = Date.now();
  const deadline = startedAt + 55_000;
  let data = await dbFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement: sql,
      ...(parameters?.length ? { parameters } : {}),
      wait_timeout: "50s",
      on_wait_timeout: "CONTINUE",
    }),
  });
  const { statement_id: sid } = data;
  let {
    status: { state },
  } = data;
  while (state === "PENDING" || state === "RUNNING") {
    if (Date.now() >= deadline) {
      logger.warn("databricks.query.timeout", { statementId: sid, durationMs: Date.now() - startedAt });
      throw new Error("Consulta ao Databricks excedeu o limite de 55 segundos.");
    }
    await new Promise((r) => setTimeout(r, 2000));
    data = await dbFetch(`/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") {
    logger.error("databricks.query.failed", { statementId: sid, state, durationMs: Date.now() - startedAt });
    throw new Error(data.status?.error?.message || "Query falhou: " + state);
  }
  const rows = data.result?.data_array || [];
  logger.info("databricks.query.completed", {
    statementId: sid,
    durationMs: Date.now() - startedAt,
    rowCount: rows.length,
  });
  return rows;
}

export async function resolveWarehouseId(): Promise<string> {
  const fromEnv = process.env.DATABRICKS_WAREHOUSE_ID?.trim();
  if (fromEnv) return fromEnv;
  if (warehouseIdCache) return warehouseIdCache;

  const { warehouses = [] } = (await dbFetch("/api/2.0/sql/warehouses")) as {
    warehouses?: { id: string; state?: string }[];
  };
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
  if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");
  warehouseIdCache = wh.id;
  return wh.id;
}

export async function getColumns(warehouseId: string, tableName: string, opts?: { force?: boolean }): Promise<string[]> {
  if (!opts?.force) {
    const cached = columnsCache.get(tableName);
    if (cached) return cached;
  }

  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  const columns = rows
    .map((row) => String(getCell(row[0]) || "").trim())
    .filter((column) => column && !column.startsWith("#"));
  columnsCache.set(tableName, columns);
  return columns;
}

export function clearColumnsCache(tableName?: string) {
  if (tableName) columnsCache.delete(tableName);
  else columnsCache.clear();
}

export function getCell(cell: DatabricksCell) {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
}

export const toInt = (v: DatabricksCell) => {
  const n = parseInt(String(getCell(v)));
  return Number.isFinite(n) ? n : 0;
};
export const toNum = (v: DatabricksCell) => {
  const n = parseFloat(String(getCell(v)));
  return Number.isFinite(n) ? n : 0;
};
export const toFloat = (v: DatabricksCell) => toNum(v);
// Escapa literais SQL: duplica a barra invertida antes da aspa, pois o parser
// do Spark trata \ como caractere de escape em literais por padrão.
export const escape = (s: unknown) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "''");
export const quoteIdent = (s: unknown) => `\`${String(s).replace(/`/g, "``")}\``;
