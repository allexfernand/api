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
  return data.result?.data_array || [];
}

const queries = [
  { label: "schema gold", sql: `DESCRIBE ${FQN}` },
  { label: "WIZ canonizada (deve ser ~9.038)", sql: `SELECT COUNT(*) FROM ${FQN} WHERE economic_group_canonical = 'WIZ'` },
  { label: "top 10 grupos canônicos", sql: `SELECT economic_group_canonical, COUNT(*) FROM ${FQN} GROUP BY economic_group_canonical ORDER BY 2 DESC LIMIT 10` },
];

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
  for (const q of queries) {
    console.log(`\n▸ ${q.label}`);
    const rows = await runQuery(wh.id, q.sql);
    rows.slice(0, 30).forEach((r) => console.log("    ", r.join("  |  ")));
  }
})();
