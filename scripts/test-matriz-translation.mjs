#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const FQN = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";
const ORG = "hive_metastore.sanus_prod.organizations";

function dbApi(method, path, body) {
  const args = ["api", method, path, "--profile", PROFILE, "--output", "json"];
  if (body !== undefined) args.push("--json", JSON.stringify(body));
  return JSON.parse(execFileSync("databricks", args, { encoding: "utf8" }));
}
async function runQuery(warehouseId, sql) {
  let data = dbApi("post", "/api/2.0/sql/statements", {
    warehouse_id: warehouseId, statement: sql, wait_timeout: "50s", on_wait_timeout: "CONTINUE",
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

const candidates = [
  "WIZ BENEFICIO EMPRESARIAL SOLUCOES E CORRETAGEM S.A",
  "AZUL LINHAS AEREAS BRASILEIRAS S.A.",
  "Origem Energia",
  "Sanus",
  "WIZ",
];

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];

  for (const groupName of candidates) {
    const g = groupName.replace(/'/g, "''");
    console.log(`\n▸ Filtro com group_name='${groupName}'`);
    const sql = `
      SELECT
        UPPER(TRIM(COALESCE(
          (SELECT NULLIF(TRIM(CAST(name_economic_group AS STRING)), '')
           FROM ${ORG}
           WHERE active = true AND UPPER(TRIM(CAST(name AS STRING))) = UPPER(TRIM('${g}'))
           LIMIT 1),
          '${g}'
        ))) AS canonico_resolvido,
        COUNT(*) AS sessoes
      FROM ${FQN} s
      WHERE UPPER(TRIM(CAST(s.economic_group_canonical AS STRING))) = UPPER(TRIM(COALESCE(
        (SELECT NULLIF(TRIM(CAST(name_economic_group AS STRING)), '')
         FROM ${ORG}
         WHERE active = true AND UPPER(TRIM(CAST(name AS STRING))) = UPPER(TRIM('${g}'))
         LIMIT 1),
        '${g}'
      )))
      GROUP BY 1
    `;
    const rows = await runQuery(wh.id, sql);
    if (rows.length === 0) console.log("    (nenhum match)");
    else rows.forEach((r) => console.log("    canonico:", r[0], " | sessoes:", r[1]));
  }
})();
