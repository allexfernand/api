#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const ORG = "hive_metastore.sanus_prod.organizations";

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
    label: "1) ANTES — orgs que aparecem como matriz_id de outra org (lógica atual)",
    sql: `
      SELECT COUNT(DISTINCT o1.name) AS total
      FROM ${ORG} o1
      WHERE o1.active = true
        AND o1.name IS NOT NULL
        AND o1.id IN (SELECT matriz_id FROM ${ORG} WHERE matriz_id IS NOT NULL)
    `,
  },
  {
    label: "2) DEPOIS — orgs com is_matriz=true OR matriz_id IS NULL",
    sql: `
      SELECT COUNT(DISTINCT o.name) AS total
      FROM ${ORG} o
      WHERE o.active = true
        AND o.name IS NOT NULL
        AND TRIM(CAST(o.name AS STRING)) != ''
        AND (o.is_matriz = true OR o.matriz_id IS NULL)
    `,
  },
  {
    label: "3) Quebra: is_matriz=true / matriz_id NULL / ambos",
    sql: `
      SELECT
        is_matriz,
        CASE WHEN matriz_id IS NULL THEN 'matriz_id NULL' ELSE 'tem matriz' END AS pai,
        COUNT(*) AS qt
      FROM ${ORG}
      WHERE active = true AND name IS NOT NULL AND TRIM(CAST(name AS STRING)) != ''
      GROUP BY is_matriz, CASE WHEN matriz_id IS NULL THEN 'matriz_id NULL' ELSE 'tem matriz' END
      ORDER BY is_matriz DESC, pai
    `,
  },
  {
    label: "4) WIZ na nova lista (deve aparecer canonicamente)",
    sql: `
      SELECT name, is_matriz, matriz_id IS NOT NULL AS tem_matriz, name_economic_group
      FROM ${ORG}
      WHERE UPPER(name) LIKE '%WIZ%' AND active = true
      ORDER BY name
    `,
  },
  {
    label: "5) Top 10 orgs novas (que não estavam antes)",
    sql: `
      WITH antes AS (
        SELECT DISTINCT o1.name
        FROM ${ORG} o1
        WHERE o1.active = true
          AND o1.id IN (SELECT matriz_id FROM ${ORG} WHERE matriz_id IS NOT NULL)
      ),
      depois AS (
        SELECT DISTINCT name
        FROM ${ORG}
        WHERE active = true AND name IS NOT NULL AND TRIM(CAST(name AS STRING)) != ''
          AND (is_matriz = true OR matriz_id IS NULL)
      )
      SELECT name FROM depois
      WHERE name NOT IN (SELECT name FROM antes WHERE name IS NOT NULL)
      ORDER BY name
      LIMIT 15
    `,
  },
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
