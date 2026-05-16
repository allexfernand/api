#!/usr/bin/env node
// Simula as queries exatas de /api/sessions para WIZ.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const FQN = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";
const GROUP_NAME = "WIZ CONCEPT SOLUCOES DE TELEATENDIMENTO LTDA";

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

const escape = (s) => String(s).replace(/'/g, "''");
const g = escape(GROUP_NAME);

const composedFilter = `(
  UPPER(TRIM(CAST(s.\`economic_group_name\` AS STRING))) = UPPER(TRIM('${g}'))
  OR UPPER(TRIM(CAST(s.\`economic_group_name\` AS STRING))) LIKE CONCAT('%', UPPER(TRIM('${g}')), '%')
  OR UPPER(TRIM('${g}')) LIKE CONCAT('%', UPPER(TRIM(CAST(s.\`economic_group_name\` AS STRING))), '%')
)`;

const sims = [
  {
    label: "company_sessions (modo company, sem meses) — bullet vem desta soma",
    sql: `
      SELECT
        COALESCE(NULLIF(TRIM(CAST(s.\`organization_name\` AS STRING)), ''), 'Sem empresa') AS empresa,
        COUNT(*) AS total
      FROM ${FQN} s
      WHERE ${composedFilter}
      GROUP BY COALESCE(NULLIF(TRIM(CAST(s.\`organization_name\` AS STRING)), ''), 'Sem empresa')
      ORDER BY total DESC
    `,
  },
  {
    label: "economic_group_finishers (modo company, sem meses)",
    sql: `
      SELECT s.\`tipo_finished_by\` AS tipo, COUNT(*) AS total
      FROM ${FQN} s
      WHERE ${composedFilter}
      GROUP BY s.\`tipo_finished_by\`
      ORDER BY total DESC
    `,
  },
  {
    label: "typifications (modo company, sem meses) — top 30",
    sql: `
      SELECT s.\`tipificacao\` AS tip, COUNT(*) AS total
      FROM ${FQN} s
      WHERE ${composedFilter}
      GROUP BY s.\`tipificacao\`
      ORDER BY total DESC
      LIMIT 30
    `,
  },
];

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
  console.log(`warehouse: ${wh.name} (${wh.state})\n`);

  for (const s of sims) {
    const start = Date.now();
    const rows = await runQuery(wh.id, s.sql);
    const ms = Date.now() - start;
    const total = rows.reduce((acc, r) => acc + Number(r[r.length - 1] || 0), 0);
    console.log(`▸ ${s.label}  (${ms}ms)`);
    console.log(`    total: ${total}`);
    rows.slice(0, 15).forEach((r) => console.log("    ", r.join("  |  ")));
    console.log();
  }
})();
