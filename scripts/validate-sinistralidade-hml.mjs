// Validação read-only dos gates 009 contra o schema de homologação.
// Reaponta os objetos v2 para SINISTRALIDADE_TARGET_CATALOG/SCHEMA (default
// sanus_databricks.sinistralidade_hml) e executa cada check, reportando
// violações. Não escreve nada.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const host = String(process.env.DATABRICKS_HOST || "").replace(/\/$/, "");
const token = process.env.DATABRICKS_TOKEN;
const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
const targetCatalog = process.env.SINISTRALIDADE_TARGET_CATALOG || "hive_metastore";
const targetSchema = process.env.SINISTRALIDADE_TARGET_SCHEMA || "sinistralidade_hml";
const target = `${targetCatalog}.${targetSchema}`;
if (!host || !token || !warehouseId) throw new Error("DATABRICKS_HOST/TOKEN/WAREHOUSE_ID obrigatórios.");

const targetObjects = [
  "sinistralidade_ingestion_manifest_v2", "sinistralidade_month_status_v2",
  "beneficiary_eligibility_snapshot_v2", "sinistralidade_quality_run_v2",
  "sinistralidade_company_alias_v2", "gold_sinistro_evento_v2", "dim_empresa_gold_v2",
  "fact_elegibilidade_mensal_gold_v2", "mart_sinistro_empresa_mes_v2", "mart_top10_mes_v2",
  "mart_top10_bimestre_v2", "mart_saude_mental_internacao_v2", "mart_ps_episodio_item_v2",
  "fact_coordenacao_evento_gold_v2", "mart_fatura_coordenacao_v2", "mart_familia_antes_depois_v2",
  "mart_comparativo_semestral_v2", "mart_evento_empresa_mes_v2", "mart_pessoa_mes_v2",
  "mart_procedimento_mes_v2", "mart_internacao_mes_v2", "mart_internacao_grupo_mes_v2",
  "mart_prestador_mes_v2", "mart_concentracao_mes_v2", "mart_ps_item_mes_v2",
  "mart_familia_mes_relativo_v2", "mart_coordenacao_empresa_mes_v2",
];

// Checks de gate: espera-se ZERO linhas. Os demais são relatórios.
const GATE_PREFIXES = [
  "grain_", "cost_reconciliation", "people_episode_reconciliation",
  "hospitalization_ps_cost_reconciliation", "event_share_totals", "null_keys",
  "concentration_consistency", "series_density", "ps_item_association",
  "eligibility_denominator",
];

function retarget(sql) {
  let output = sql;
  for (const object of targetObjects) {
    output = output.replaceAll(`hive_metastore.sanus_prod.${object}`, `${target}.${object}`);
  }
  return output;
}

function splitStatements(sql) {
  const withoutLineComments = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  for (let index = 0; index < withoutLineComments.length; index += 1) {
    const char = withoutLineComments[index];
    const next = withoutLineComments[index + 1];
    if (char === "'" && inSingleQuote && next === "'") { current += "''"; index += 1; continue; }
    if (char === "'") inSingleQuote = !inSingleQuote;
    if (char === ";" && !inSingleQuote) {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function statement(sql) {
  const response = await fetch(`${host}/api/2.0/sql/statements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: "50s", on_wait_timeout: "CONTINUE" }),
  });
  if (!response.ok) throw new Error(`Databricks ${response.status}: ${await response.text()}`);
  let payload = await response.json();
  const id = payload.statement_id;
  while (["PENDING", "RUNNING"].includes(payload.status?.state)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
    const poll = await fetch(`${host}/api/2.0/sql/statements/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    payload = await poll.json();
  }
  if (payload.status?.state !== "SUCCEEDED") throw new Error(payload.status?.error?.message || "statement failed");
  return payload.result?.data_array ?? [];
}

const raw = await readFile(resolve("databricks/sinistralidade/sql/009_longitudinal_quality_checks.sql"), "utf8");
const statements = splitStatements(retarget(raw));
console.log(`Alvo: ${target} · ${statements.length} checks\n`);

let failures = 0;
for (const sql of statements) {
  const nameMatch = sql.match(/'([a-z0-9_]+)' AS check_name/i);
  const name = nameMatch ? nameMatch[1] : sql.slice(0, 60).replace(/\s+/g, " ");
  const isGate = GATE_PREFIXES.some((prefix) => name.startsWith(prefix));
  try {
    const rows = await statement(sql);
    if (isGate) {
      const status = rows.length === 0 ? "PASSOU" : `FALHOU (${rows.length} violações)`;
      if (rows.length > 0) {
        failures += 1;
        console.log(`✗ ${name}: ${status}`);
        for (const row of rows.slice(0, 3)) console.log("   ", JSON.stringify(row));
      } else {
        console.log(`✓ ${name}: ${status}`);
      }
    } else {
      console.log(`• ${name}: relatório com ${rows.length} linha(s)`);
      for (const row of rows.slice(0, 3)) console.log("   ", JSON.stringify(row));
    }
  } catch (cause) {
    failures += 1;
    console.log(`✗ ${name}: ERRO — ${cause instanceof Error ? cause.message.slice(0, 200) : cause}`);
  }
}

console.log(`\n${failures === 0 ? "TODOS OS GATES PASSARAM" : `${failures} gate(s) com problema`}`);
process.exitCode = failures === 0 ? 0 : 1;
