#!/usr/bin/env node
// Valida Q12B: confirma que IA = sessões sem nenhuma mensagem sender_type='agent'
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const FQN = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";
const MSG = "hive_metastore.sanus_prod.botmaker_message";

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

const queries = [
  {
    label: "Q12B na gold (WIZ): contagem por tipo_atendimento_agent",
    sql: `
      SELECT tipo_atendimento_agent, COUNT(*) AS sessoes
      FROM ${FQN}
      WHERE economic_group_canonical = 'WIZ'
      GROUP BY tipo_atendimento_agent
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "Validação cruzada: WIZ sem nenhum sender_type='agent' (direto da source)",
    sql: `
      WITH wiz_sessions AS (
        SELECT session_id FROM ${FQN} WHERE economic_group_canonical = 'WIZ'
      ),
      agent_sessions AS (
        SELECT DISTINCT CAST(session_id AS STRING) AS session_id
        FROM ${MSG} WHERE sender_type = 'agent'
      )
      SELECT
        CASE WHEN ag.session_id IS NULL THEN 'IA (sem mensagem agent)' ELSE 'Humano (teve agent)' END AS tipo,
        COUNT(*) AS sessoes
      FROM wiz_sessions w
      LEFT JOIN agent_sessions ag ON ag.session_id = w.session_id
      GROUP BY 1
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
