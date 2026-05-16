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
  return data.result?.data_array || [];
}

const queries = [
  {
    label: "1) WIZ no organizations.name_economic_group (cross-reference)",
    sql: `
      SELECT name_economic_group, COUNT(*) AS qt_orgs
      FROM ${ORG}
      WHERE UPPER(name_economic_group) LIKE '%WIZ%'
      GROUP BY name_economic_group
      ORDER BY qt_orgs DESC
    `,
  },
  {
    label: "2) WIZ via botmaker_session.economic_group_id JOIN org.matriz",
    sql: `
      WITH wiz_sessions AS (
        SELECT
          s.economic_group_id,
          s.economic_group_name,
          s.organization_id
        FROM ${SESS} s
        WHERE UPPER(s.economic_group_name) LIKE '%WIZ%'
          AND s.creation_time IS NOT NULL
      )
      SELECT
        w.economic_group_id,
        w.economic_group_name,
        o.name AS matriz_name,
        o.name_economic_group AS canonico,
        COUNT(*) AS sessoes
      FROM wiz_sessions w
      LEFT JOIN ${ORG} o
        ON CAST(o.id AS STRING) = CAST(w.economic_group_id AS STRING)
      GROUP BY w.economic_group_id, w.economic_group_name, o.name, o.name_economic_group
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "3) Distribuição: economic_group_id NULL vs preenchido",
    sql: `
      SELECT
        CASE WHEN economic_group_id IS NULL OR economic_group_id = '' THEN 'NULL/vazio' ELSE 'preenchido' END AS estado,
        COUNT(*) AS sessoes
      FROM ${SESS}
      WHERE creation_time IS NOT NULL
      GROUP BY 1
    `,
  },
  {
    label: "4) Total agrupado por canonico para WIZ",
    sql: `
      SELECT
        COALESCE(o.name_economic_group, s.economic_group_name, 'Sem grupo') AS canonico,
        COUNT(*) AS sessoes
      FROM ${SESS} s
      LEFT JOIN ${ORG} o
        ON CAST(o.id AS STRING) = CAST(s.economic_group_id AS STRING)
      WHERE s.creation_time IS NOT NULL
        AND (
          UPPER(s.economic_group_name) LIKE '%WIZ%'
          OR UPPER(o.name_economic_group) LIKE '%WIZ%'
        )
      GROUP BY COALESCE(o.name_economic_group, s.economic_group_name, 'Sem grupo')
      ORDER BY sessoes DESC
    `,
  },
];

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];

  for (const q of queries) {
    console.log(`\n▸ ${q.label}`);
    const rows = await runQuery(wh.id, q.sql);
    rows.forEach((r) => console.log("    ", r.join("  |  ")));
  }
})();
