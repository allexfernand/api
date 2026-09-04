#!/usr/bin/env node
// Cria a tabela ouro `dashboard_sessions_base_gold` + OPTIMIZE + ANALYZE.
// Usa o Databricks CLI (perfil `databricks-sanus`) para autenticar.
// Uso: node scripts/create-sessions-gold.mjs

import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const POLL_INTERVAL_MS = 4000;
const MAX_WAIT_MS = 30 * 60 * 1000;

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(label, message, color = "cyan") {
  const stamp = new Date().toLocaleTimeString();
  process.stdout.write(
    `${colors.dim}[${stamp}]${colors.reset} ${colors[color]}${colors.bold}${label}${colors.reset} ${message}\n`,
  );
}

function dbApi(method, path, body) {
  const args = ["api", method, path, "--profile", PROFILE, "--output", "json"];
  if (body !== undefined) {
    args.push("--json", JSON.stringify(body));
  }
  const out = execFileSync("databricks", args, { encoding: "utf8" });
  return JSON.parse(out);
}

async function pickWarehouse() {
  const { warehouses = [] } = dbApi("get", "/api/2.0/sql/warehouses");
  if (!warehouses.length) throw new Error("Nenhum SQL Warehouse disponível.");
  const running = warehouses.find((w) => w.state === "RUNNING");
  const wh = running || warehouses[0];
  if (!running) {
    log("warehouse", `iniciando ${wh.name} (${wh.id})…`, "yellow");
    try {
      dbApi("post", `/api/2.0/sql/warehouses/${wh.id}/start`);
    } catch (err) {
      log("warehouse", `start falhou (talvez já esteja iniciando): ${err.message}`, "yellow");
    }
  }
  return wh;
}

async function runStatement(warehouseId, sql, label) {
  const start = Date.now();
  log(label, "enviando…");
  let data = dbApi("post", "/api/2.0/sql/statements", {
    warehouse_id: warehouseId,
    statement: sql,
    wait_timeout: "50s",
    on_wait_timeout: "CONTINUE",
  });
  let { statement_id: sid, status: { state } } = data;
  while (state === "PENDING" || state === "RUNNING") {
    if (Date.now() - start > MAX_WAIT_MS) throw new Error(`${label}: timeout > 30min`);
    await sleep(POLL_INTERVAL_MS);
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`${colors.dim}  ↳ ${state} (${elapsed}s)\r${colors.reset}`);
    data = dbApi("get", `/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  process.stdout.write("\x1b[2K\r");
  const seconds = Math.round((Date.now() - start) / 1000);
  if (state !== "SUCCEEDED") {
    const msg = data.status?.error?.message || `falhou: ${state}`;
    log(label, `${colors.red}ERRO${colors.reset} (${seconds}s): ${msg}`, "red");
    throw new Error(msg);
  }
  log(label, `${colors.green}ok${colors.reset} em ${seconds}s`, "green");
}

const FQN = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";

const STEPS = [
  {
    label: "1/3 CREATE TABLE",
    sql: `
CREATE OR REPLACE TABLE ${FQN}
USING DELTA
AS
WITH session_msg_flags AS (
  SELECT
    CAST(session_id AS STRING) AS session_id,
    MAX(CASE WHEN LOWER(TRIM(CAST(sender_type AS STRING))) = 'agent' THEN 1 ELSE 0 END) AS teve_humano,
    MAX(CASE WHEN LOWER(TRIM(CAST(sender_type AS STRING))) = 'user' THEN 1 ELSE 0 END) AS teve_user
  FROM hive_metastore.sanus_prod.botmaker_message
  GROUP BY CAST(session_id AS STRING)
),
sessions_base AS (
  SELECT
    CAST(s.session_id AS STRING) AS session_id,
    try_cast(s.creation_time AS TIMESTAMP) AS creation_ts,
    DATE_FORMAT(try_cast(s.creation_time AS TIMESTAMP), 'yyyy-MM') AS mes,
    DATE_FORMAT(try_cast(s.creation_time AS TIMESTAMP), 'yyyy-MM-dd') AS dia,
    CAST(s.organization_id AS STRING) AS organization_id,
    NULLIF(TRIM(CAST(o.name AS STRING)), '') AS organization_name,
    CASE
      WHEN s.economic_group_name IS NULL OR TRIM(CAST(s.economic_group_name AS STRING)) = ''
      THEN 'Nulos'
      ELSE TRIM(CAST(s.economic_group_name AS STRING))
    END AS economic_group_name,
    COALESCE(
      NULLIF(TRIM(CAST(o.name_economic_group AS STRING)), ''),
      NULLIF(TRIM(CAST(s.economic_group_name AS STRING)), ''),
      'Nulos'
    ) AS economic_group_canonical,
    CASE
      WHEN s.variables['typification'] IS NULL THEN '(NULO)'
      WHEN TRIM(CAST(s.variables['typification'] AS STRING)) = '' THEN '(VAZIO/BRANCO)'
      ELSE TRIM(CAST(s.variables['typification'] AS STRING))
    END AS tipificacao,
    NULLIF(TRIM(CAST(s.finished_by AS STRING)), '') AS finished_by,
    CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_finished_by,
    COALESCE(sha.teve_humano, 0) AS teve_humano_agent,
    COALESCE(sha.teve_user, 0) AS teve_user,
    CASE WHEN COALESCE(sha.teve_humano, 0) = 1 THEN 'Humano' ELSE 'IA' END AS tipo_atendimento_agent,
    COALESCE(
      CASE
        WHEN NULLIF(TRIM(CAST(COALESCE(
          s.variables['beneficiary_id'],
          s.variables['beneficiaryId'],
          s.variables['beneficiario_id'],
          s.variables['id_beneficiario'],
          s.variables['user_id'],
          s.variables['userId'],
          s.variables['customer_id'],
          s.variables['customerId']
        ) AS STRING)), '') IS NOT NULL
        THEN CONCAT('beneficiary:', NULLIF(TRIM(CAST(COALESCE(
          s.variables['beneficiary_id'],
          s.variables['beneficiaryId'],
          s.variables['beneficiario_id'],
          s.variables['id_beneficiario'],
          s.variables['user_id'],
          s.variables['userId'],
          s.variables['customer_id'],
          s.variables['customerId']
        ) AS STRING)), ''))
      END,
      CASE
        WHEN NULLIF(REGEXP_REPLACE(CAST(COALESCE(
          s.variables['cpf'],
          s.variables['CPF'],
          s.variables['document'],
          s.variables['documento'],
          s.variables['cpf_cnpj'],
          s.variables['document_number'],
          s.variables['beneficiary_cpf'],
          s.variables['cpf_beneficiario'],
          s.variables['cpf_beneficiary']
        ) AS STRING), '[^0-9]', ''), '') IS NOT NULL
        THEN CONCAT('cpf:', NULLIF(REGEXP_REPLACE(CAST(COALESCE(
          s.variables['cpf'],
          s.variables['CPF'],
          s.variables['document'],
          s.variables['documento'],
          s.variables['cpf_cnpj'],
          s.variables['document_number'],
          s.variables['beneficiary_cpf'],
          s.variables['cpf_beneficiario'],
          s.variables['cpf_beneficiary']
        ) AS STRING), '[^0-9]', ''), ''))
      END
    ) AS beneficiary_key,
    CURRENT_TIMESTAMP() AS refreshed_at
  FROM hive_metastore.sanus_prod.botmaker_session s
  LEFT JOIN hive_metastore.sanus_prod.organizations o
    ON CAST(s.organization_id AS STRING) = CAST(o.id AS STRING)
  LEFT JOIN session_msg_flags sha
    ON CAST(s.session_id AS STRING) = sha.session_id
  WHERE s.creation_time IS NOT NULL
)
SELECT * FROM sessions_base
`.trim(),
  },
  {
    label: "2/3 OPTIMIZE",
    sql: `OPTIMIZE ${FQN} ZORDER BY (mes, economic_group_canonical, organization_name)`,
  },
  {
    label: "3/3 ANALYZE",
    sql: `ANALYZE TABLE ${FQN} COMPUTE STATISTICS FOR COLUMNS mes, dia, economic_group_canonical, economic_group_name, organization_name, organization_id, tipo_atendimento_agent, tipo_finished_by, tipificacao, finished_by, teve_user`,
  },
];

(async () => {
  try {
    const wh = await pickWarehouse();
    log("warehouse", `${wh.name} • ${wh.id} • ${wh.state}`, "cyan");
    for (const step of STEPS) {
      await runStatement(wh.id, step.sql, step.label);
    }
    log("done", `tabela pronta em ${FQN}`, "green");
  } catch (err) {
    log("fatal", err.message || String(err), "red");
    process.exit(1);
  }
})();
