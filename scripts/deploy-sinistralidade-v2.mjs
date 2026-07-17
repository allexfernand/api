import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
const host = String(process.env.DATABRICKS_HOST || "").replace(/\/$/, "");
const token = process.env.DATABRICKS_TOKEN;
const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
const targetCatalog = process.env.SINISTRALIDADE_TARGET_CATALOG || "sanus_databricks";
const targetSchema = process.env.SINISTRALIDADE_TARGET_SCHEMA || "sinistralidade_hml";
const target = `${targetCatalog}.${targetSchema}`;
const createSchema = process.env.SINISTRALIDADE_CREATE_SCHEMA !== "false";

const allFiles = [
  "001_control_tables.sql",
  "002_gold_event_v2.sql",
  "003_dimensions_and_eligibility.sql",
  "004_analytics_marts.sql",
  "006_quality_baseline.sql",
  "007_manifest_baseline.sql",
  "008_longitudinal_marts.sql",
  "010_longitudinal_baseline.sql",
];
const only = process.argv.find((argument) => argument.startsWith("--only="))?.split("=")[1];
const files = only ? allFiles.filter((file) => file === only) : allFiles;
if (only && files.length === 0) throw new Error(`Arquivo SQL desconhecido em --only: ${only}`);

const targetObjects = [
  "sinistralidade_ingestion_manifest_v2",
  "sinistralidade_month_status_v2",
  "beneficiary_eligibility_snapshot_v2",
  "sinistralidade_quality_run_v2",
  "sinistralidade_company_alias_v2",
  "gold_sinistro_evento_v2",
  "dim_empresa_gold_v2",
  "fact_elegibilidade_mensal_gold_v2",
  "mart_sinistro_empresa_mes_v2",
  "mart_top10_mes_v2",
  "mart_top10_bimestre_v2",
  "mart_saude_mental_internacao_v2",
  "mart_ps_episodio_item_v2",
  "fact_coordenacao_evento_gold_v2",
  "mart_fatura_coordenacao_v2",
  "mart_familia_antes_depois_v2",
  "mart_comparativo_semestral_v2",
  "mart_evento_empresa_mes_v2",
  "mart_pessoa_mes_v2",
  "mart_procedimento_mes_v2",
  "mart_internacao_mes_v2",
  "mart_internacao_grupo_mes_v2",
  "mart_prestador_mes_v2",
  "mart_concentracao_mes_v2",
  "mart_ps_item_mes_v2",
  "mart_familia_mes_relativo_v2",
  "mart_coordenacao_empresa_mes_v2",
];

function retarget(sql) {
  let output = sql;
  for (const object of targetObjects) {
    output = output.replaceAll(`hive_metastore.sanus_prod.${object}`, `${target}.${object}`);
  }
  return output;
}

function splitStatements(sql) {
  const withoutLineComments = sql.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  for (let index = 0; index < withoutLineComments.length; index += 1) {
    const char = withoutLineComments[index];
    const next = withoutLineComments[index + 1];
    if (char === "'" && inSingleQuote && next === "'") {
      current += "''";
      index += 1;
      continue;
    }
    if (char === "'") inSingleQuote = !inSingleQuote;
    if (char === ";" && !inSingleQuote) {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += char;
    }
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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
    const poll = await fetch(`${host}/api/2.0/sql/statements/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!poll.ok) throw new Error(`Databricks poll ${poll.status}: ${await poll.text()}`);
    payload = await poll.json();
  }
  if (payload.status?.state !== "SUCCEEDED") throw new Error(payload.status?.error?.message || `Statement ${id} failed`);
}

if (apply && (!host || !token || !warehouseId)) {
  throw new Error("DATABRICKS_HOST, DATABRICKS_TOKEN e DATABRICKS_WAREHOUSE_ID são obrigatórios para --apply.");
}

const planned = [];
for (const file of files) {
  const raw = await readFile(resolve("databricks/sinistralidade/sql", file), "utf8");
  const statements = splitStatements(retarget(raw));
  planned.push({ file, statements });
}

console.log(JSON.stringify({ mode: apply ? "apply" : "plan", target, files: planned.map(({ file, statements }) => ({ file, statements: statements.length })) }, null, 2));

if (apply) {
  if (createSchema) {
    await statement(`CREATE SCHEMA IF NOT EXISTS ${target} COMMENT 'Homologação isolada da sinistralidade v2'`);
  }
  for (const { file, statements } of planned) {
    for (let index = 0; index < statements.length; index += 1) {
      process.stdout.write(`${file} ${index + 1}/${statements.length}\n`);
      await statement(statements[index]);
    }
  }
}
