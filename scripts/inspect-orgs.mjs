#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const ORG = "hive_metastore.sanus_prod.organizations";
const SESS = "hive_metastore.sanus_prod.botmaker_session";

function dbApi(method, path, body) {
  const args = ["api", method, path, "--profile", PROFILE, "--output", "json"];
  if (body !== undefined) args.push("--json", JSON.stringify(body));
  return JSON.parse(execFileSync("databricks", args, { encoding: "utf8" }));
}

async function runQuery(warehouseId, sql) {
  let data = dbApi("post", "/api/2.0/sql/statements", {
    warehouse_id: warehouseId,
    statement: sql,
    wait_timeout: "50s",
    on_wait_timeout: "CONTINUE",
  });
  let { statement_id: sid, status: { state } } = data;
  while (state === "PENDING" || state === "RUNNING") {
    await sleep(2000);
    data = dbApi("get", `/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || state);
  return { schema: data.manifest?.schema?.columns || [], rows: data.result?.data_array || [] };
}

const queries = [
  { label: "schema organizations", sql: `DESCRIBE TABLE ${ORG}` },
  { label: "amostra organizations (5 linhas)", sql: `SELECT * FROM ${ORG} LIMIT 5` },
  { label: "buscar colunas com 'group/grupo/economic'", sql: `
    SELECT column_name FROM information_schema.columns
    WHERE table_catalog = 'hive_metastore'
      AND table_schema = 'sanus_prod'
      AND table_name = 'organizations'
      AND (LOWER(column_name) LIKE '%group%' OR LOWER(column_name) LIKE '%grupo%' OR LOWER(column_name) LIKE '%econom%')
  ` },
  { label: "schema botmaker_session", sql: `DESCRIBE TABLE ${SESS}` },
];

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];

  for (const q of queries) {
    console.log(`\n▸ ${q.label}`);
    try {
      const { schema, rows } = await runQuery(wh.id, q.sql);
      if (q.label.startsWith("schema") || q.label.startsWith("buscar")) {
        rows.forEach((r) => console.log("    ", r.join("  |  ")));
      } else {
        console.log("    cols:", schema.map((c) => c.name).join(", "));
        rows.slice(0, 3).forEach((r, i) => {
          console.log(`    row${i+1}:`);
          schema.forEach((c, j) => {
            const v = r[j];
            const s = v === null ? "NULL" : (typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 100));
            console.log(`       ${c.name}: ${s}`);
          });
        });
      }
    } catch (err) {
      console.log("    ERRO:", err.message);
    }
  }
})();
