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
    label: "1) WIZ usando o.name_economic_group via JOIN por organization_id",
    sql: `
      SELECT
        COALESCE(NULLIF(TRIM(o.name_economic_group), ''), '⚠ sem mapeamento') AS canonico,
        s.economic_group_name AS texto_livre,
        COUNT(*) AS sessoes
      FROM ${SESS} s
      LEFT JOIN ${ORG} o ON CAST(o.id AS STRING) = CAST(s.organization_id AS STRING)
      WHERE s.creation_time IS NOT NULL
        AND (
          UPPER(s.economic_group_name) LIKE '%WIZ%'
          OR UPPER(o.name_economic_group) LIKE '%WIZ%'
        )
      GROUP BY o.name_economic_group, s.economic_group_name
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "2) Total agrupado por canonico (só name_economic_group)",
    sql: `
      SELECT
        COALESCE(NULLIF(TRIM(o.name_economic_group), ''), '⚠ sem mapeamento') AS canonico,
        COUNT(*) AS sessoes
      FROM ${SESS} s
      LEFT JOIN ${ORG} o ON CAST(o.id AS STRING) = CAST(s.organization_id AS STRING)
      WHERE s.creation_time IS NOT NULL
        AND (
          UPPER(s.economic_group_name) LIKE '%WIZ%'
          OR UPPER(o.name_economic_group) LIKE '%WIZ%'
        )
      GROUP BY o.name_economic_group
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "3) Distribuição de canonização (todos grupos)",
    sql: `
      WITH base AS (
        SELECT
          COALESCE(NULLIF(TRIM(o.name_economic_group), ''), NULLIF(TRIM(s.economic_group_name), '')) AS grupo_canonico,
          NULLIF(TRIM(o.name_economic_group), '') IS NOT NULL AS via_org_join
        FROM ${SESS} s
        LEFT JOIN ${ORG} o ON CAST(o.id AS STRING) = CAST(s.organization_id AS STRING)
        WHERE s.creation_time IS NOT NULL
      )
      SELECT
        CASE
          WHEN grupo_canonico IS NULL THEN 'sem grupo (NULL)'
          WHEN via_org_join THEN 'canonizado via organizations.name_economic_group'
          ELSE 'só economic_group_name (texto livre, sem org)'
        END AS estado,
        COUNT(*) AS sessoes
      FROM base
      GROUP BY 1
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "4) Top 15 grupos canônicos",
    sql: `
      SELECT
        COALESCE(NULLIF(TRIM(o.name_economic_group), ''), NULLIF(TRIM(s.economic_group_name), ''), 'Nulos') AS canonico,
        COUNT(*) AS sessoes
      FROM ${SESS} s
      LEFT JOIN ${ORG} o ON CAST(o.id AS STRING) = CAST(s.organization_id AS STRING)
      WHERE s.creation_time IS NOT NULL
      GROUP BY 1
      ORDER BY sessoes DESC
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
    rows.forEach((r) => console.log("    ", r.join("  |  ")));
  }
})();
