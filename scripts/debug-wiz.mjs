#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const FQN = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";
const NEEDLE = "WIZ CONCEPT SOLUCOES DE TELEATENDIMENTO LTDA";

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
  {
    label: "1) variações de economic_group_name contendo 'WIZ'",
    sql: `
      SELECT economic_group_name, COUNT(*) AS total
      FROM ${FQN}
      WHERE UPPER(economic_group_name) LIKE '%WIZ%'
      GROUP BY economic_group_name
      ORDER BY total DESC
    `,
  },
  {
    label: "2) total exato com '= NEEDLE'",
    sql: `
      SELECT COUNT(*) AS total
      FROM ${FQN}
      WHERE UPPER(TRIM(CAST(economic_group_name AS STRING))) = UPPER(TRIM('${NEEDLE}'))
    `,
  },
  {
    label: "3) total com a CONDIÇÃO COMPOSTA usada na API (LIKE bidirecional)",
    sql: `
      SELECT COUNT(*) AS total
      FROM ${FQN}
      WHERE
        UPPER(TRIM(CAST(economic_group_name AS STRING))) = UPPER(TRIM('${NEEDLE}'))
        OR UPPER(TRIM(CAST(economic_group_name AS STRING))) LIKE CONCAT('%', UPPER(TRIM('${NEEDLE}')), '%')
        OR UPPER(TRIM('${NEEDLE}')) LIKE CONCAT('%', UPPER(TRIM(CAST(economic_group_name AS STRING))), '%')
    `,
  },
  {
    label: "4) breakdown por organization_name DENTRO do filtro composto",
    sql: `
      SELECT
        COALESCE(NULLIF(TRIM(CAST(organization_name AS STRING)), ''), 'Sem empresa') AS empresa,
        COUNT(*) AS total
      FROM ${FQN}
      WHERE
        UPPER(TRIM(CAST(economic_group_name AS STRING))) = UPPER(TRIM('${NEEDLE}'))
        OR UPPER(TRIM(CAST(economic_group_name AS STRING))) LIKE CONCAT('%', UPPER(TRIM('${NEEDLE}')), '%')
        OR UPPER(TRIM('${NEEDLE}')) LIKE CONCAT('%', UPPER(TRIM(CAST(economic_group_name AS STRING))), '%')
      GROUP BY COALESCE(NULLIF(TRIM(CAST(organization_name AS STRING)), ''), 'Sem empresa')
      ORDER BY total DESC
      LIMIT 20
    `,
  },
  {
    label: "5) breakdown por organization_name de TODA a WIZ (LIKE simples)",
    sql: `
      SELECT
        COALESCE(NULLIF(TRIM(CAST(organization_name AS STRING)), ''), 'Sem empresa') AS empresa,
        economic_group_name,
        COUNT(*) AS total
      FROM ${FQN}
      WHERE UPPER(economic_group_name) LIKE '%WIZ%'
      GROUP BY COALESCE(NULLIF(TRIM(CAST(organization_name AS STRING)), ''), 'Sem empresa'), economic_group_name
      ORDER BY total DESC
      LIMIT 20
    `,
  },
];

const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
console.log(`warehouse: ${wh.name} (${wh.state})\n`);

for (const q of queries) {
  console.log(`▸ ${q.label}`);
  const rows = await runQuery(wh.id, q.sql);
  rows.slice(0, 30).forEach((r) => console.log("    ", r.join("  |  ")));
  console.log();
}
