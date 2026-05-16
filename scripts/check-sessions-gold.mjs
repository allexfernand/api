#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const FQN = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";

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
  return { columns: data.manifest?.schema?.columns || [], rows: data.result?.data_array || [] };
}

const checks = [
  { label: "row count", sql: `SELECT COUNT(*) AS total FROM ${FQN}` },
  { label: "min/max mes", sql: `SELECT MIN(mes), MAX(mes) FROM ${FQN}` },
  { label: "tipo_atendimento_agent", sql: `SELECT tipo_atendimento_agent, COUNT(*) FROM ${FQN} GROUP BY tipo_atendimento_agent ORDER BY 2 DESC` },
  { label: "top 5 economic_group_name (mes corrente)", sql: `SELECT economic_group_name, COUNT(*) FROM ${FQN} WHERE mes = DATE_FORMAT(current_date(), 'yyyy-MM') GROUP BY economic_group_name ORDER BY 2 DESC LIMIT 5` },
];

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
  console.log(`warehouse: ${wh.name} (${wh.state})\n`);
  const start = Date.now();
  for (const c of checks) {
    const t0 = Date.now();
    const { rows } = await runQuery(wh.id, c.sql);
    const ms = Date.now() - t0;
    console.log(`▸ ${c.label}  (${ms}ms)`);
    rows.slice(0, 8).forEach((r) => console.log("    ", r.join("  |  ")));
    console.log();
  }
  console.log(`total: ${Date.now() - start}ms`);
})();
