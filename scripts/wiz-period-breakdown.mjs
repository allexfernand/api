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

const composedFilter = `(
  UPPER(TRIM(CAST(s.\`economic_group_name\` AS STRING))) = UPPER(TRIM('WIZ CONCEPT SOLUCOES DE TELEATENDIMENTO LTDA'))
  OR UPPER(TRIM(CAST(s.\`economic_group_name\` AS STRING))) LIKE CONCAT('%', UPPER(TRIM('WIZ CONCEPT SOLUCOES DE TELEATENDIMENTO LTDA')), '%')
  OR UPPER(TRIM('WIZ CONCEPT SOLUCOES DE TELEATENDIMENTO LTDA')) LIKE CONCAT('%', UPPER(TRIM(CAST(s.\`economic_group_name\` AS STRING))), '%')
)`;

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];

  console.log("▸ WIZ por mês (filtro composto)");
  let rows = await runQuery(wh.id, `
    SELECT s.\`mes\` AS mes, COUNT(*) AS total
    FROM ${FQN} s
    WHERE ${composedFilter}
    GROUP BY s.\`mes\`
    ORDER BY mes
  `);
  rows.forEach((r) => console.log("    ", r.join("  |  ")));

  console.log("\n▸ WIZ no mês corrente (2026-05) por organization_name");
  rows = await runQuery(wh.id, `
    SELECT
      COALESCE(NULLIF(TRIM(CAST(s.\`organization_name\` AS STRING)), ''), 'Sem empresa') AS empresa,
      COUNT(*) AS total
    FROM ${FQN} s
    WHERE ${composedFilter} AND s.\`mes\` = '2026-05'
    GROUP BY COALESCE(NULLIF(TRIM(CAST(s.\`organization_name\` AS STRING)), ''), 'Sem empresa')
    ORDER BY total DESC
  `);
  const total = rows.reduce((acc, r) => acc + Number(r[1]), 0);
  console.log(`    total mes corrente: ${total}`);
  rows.forEach((r) => console.log("    ", r.join("  |  ")));
})();
