#!/usr/bin/env node
// Valida cobertura de CPF nas sessões e potencial de mapear titular/dependente.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const GOLD = "hive_metastore.sanus_prod.dashboard_sessions_base_gold";
const SESSION = "hive_metastore.sanus_prod.botmaker_session";
const BENEF = "hive_metastore.sanus_prod.beneficiaries";
const DELETED = "hive_metastore.sanus_prod.users_deleted";

function dbApi(method, path, body) {
  const args = ["api", method, path, "--profile", PROFILE, "--output", "json"];
  if (body !== undefined) args.push("--json", JSON.stringify(body));
  return JSON.parse(execFileSync("databricks", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));
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
    await sleep(2500);
    data = dbApi("get", `/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || state);
  return data.result?.data_array || [];
}

function printRows(label, rows) {
  console.log(`\n▸ ${label}`);
  if (!rows.length) {
    console.log("    (sem linhas)");
    return;
  }
  rows.forEach((r) => console.log("    ", r.join("  |  ")));
}

const queries = [
  {
    label: "1) Cobertura de identidade na gold (últimos 12 meses)",
    sql: `
      WITH base AS (
        SELECT
          beneficiary_key,
          CASE
            WHEN beneficiary_key IS NULL OR TRIM(beneficiary_key) = '' THEN 'sem_chave'
            WHEN beneficiary_key LIKE 'cpf:%' THEN 'cpf'
            WHEN beneficiary_key LIKE 'beneficiary:%' THEN 'beneficiary_id'
            ELSE 'outra'
          END AS identidade
        FROM ${GOLD}
        WHERE mes >= DATE_FORMAT(ADD_MONTHS(TRUNC(CURRENT_DATE(), 'MM'), -11), 'yyyy-MM')
      )
      SELECT
        identidade,
        COUNT(*) AS sessoes,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct
      FROM base
      GROUP BY identidade
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "2) Cobertura mês a mês (últimos 12) — % com CPF vs sem chave",
    sql: `
      SELECT
        mes,
        COUNT(*) AS total,
        SUM(CASE WHEN beneficiary_key LIKE 'cpf:%' THEN 1 ELSE 0 END) AS com_cpf,
        SUM(CASE WHEN beneficiary_key LIKE 'beneficiary:%' THEN 1 ELSE 0 END) AS so_beneficiary_id,
        SUM(CASE WHEN beneficiary_key IS NULL OR TRIM(beneficiary_key) = '' THEN 1 ELSE 0 END) AS sem_chave,
        ROUND(100.0 * SUM(CASE WHEN beneficiary_key LIKE 'cpf:%' THEN 1 ELSE 0 END) / COUNT(*), 2) AS pct_cpf
      FROM ${GOLD}
      WHERE mes >= DATE_FORMAT(ADD_MONTHS(TRUNC(CURRENT_DATE(), 'MM'), -11), 'yyyy-MM')
      GROUP BY mes
      ORDER BY mes
    `,
  },
  {
    label: "3) Das sessões com CPF: match em beneficiaries/users_deleted → titular/dependente",
    sql: `
      WITH sess AS (
        SELECT
          LPAD(REGEXP_REPLACE(SUBSTRING(beneficiary_key, 5), '[^0-9]', ''), 11, '0') AS cpf_norm
        FROM ${GOLD}
        WHERE mes >= DATE_FORMAT(ADD_MONTHS(TRUNC(CURRENT_DATE(), 'MM'), -11), 'yyyy-MM')
          AND beneficiary_key LIKE 'cpf:%'
      ),
      beneficiary_types AS (
        SELECT
          LPAD(REGEXP_REPLACE(CAST(b.cpf AS STRING), '[^0-9]', ''), 11, '0') AS cpf_norm,
          CASE
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) = 1 THEN 'DEPENDENTE'
            ELSE 'SEM_TIPO'
          END AS tipo
        FROM ${BENEF} b
        WHERE b.cpf IS NOT NULL AND TRIM(CAST(b.cpf AS STRING)) != ''
        GROUP BY 1
      ),
      deleted_types AS (
        SELECT
          LPAD(REGEXP_REPLACE(CAST(ud.cpf AS STRING), '[^0-9]', ''), 11, '0') AS cpf_norm,
          CASE
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(CAST(ud.data['type_kinship'] AS STRING), ''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(CAST(ud.data['type_kinship'] AS STRING), ''))) NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) = 1 THEN 'DEPENDENTE'
            ELSE 'SEM_TIPO'
          END AS tipo
        FROM ${DELETED} ud
        WHERE ud.cpf IS NOT NULL AND TRIM(CAST(ud.cpf AS STRING)) != ''
        GROUP BY 1
      ),
      classified AS (
        SELECT
          CASE
            WHEN s.cpf_norm IS NULL OR s.cpf_norm = '' OR s.cpf_norm = '00000000000' THEN 'CPF_INVALIDO'
            ELSE COALESCE(bt.tipo, dt.tipo, 'SEM_CADASTRO')
          END AS classe
        FROM sess s
        LEFT JOIN beneficiary_types bt ON bt.cpf_norm = s.cpf_norm
        LEFT JOIN deleted_types dt ON dt.cpf_norm = s.cpf_norm AND bt.tipo IS NULL
      )
      SELECT
        classe,
        COUNT(*) AS sessoes,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_entre_com_cpf
      FROM classified
      GROUP BY classe
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "4) Visão total (últimos 12): classificado vs não mapeável",
    sql: `
      WITH base AS (
        SELECT
          CASE
            WHEN beneficiary_key LIKE 'cpf:%'
              THEN LPAD(REGEXP_REPLACE(SUBSTRING(beneficiary_key, 5), '[^0-9]', ''), 11, '0')
            ELSE NULL
          END AS cpf_norm,
          CASE
            WHEN beneficiary_key IS NULL OR TRIM(beneficiary_key) = '' THEN 'sem_chave'
            WHEN beneficiary_key LIKE 'cpf:%' THEN 'cpf'
            WHEN beneficiary_key LIKE 'beneficiary:%' THEN 'beneficiary_id'
            ELSE 'outra'
          END AS identidade
        FROM ${GOLD}
        WHERE mes >= DATE_FORMAT(ADD_MONTHS(TRUNC(CURRENT_DATE(), 'MM'), -11), 'yyyy-MM')
      ),
      beneficiary_types AS (
        SELECT
          LPAD(REGEXP_REPLACE(CAST(b.cpf AS STRING), '[^0-9]', ''), 11, '0') AS cpf_norm,
          CASE
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) = 1 THEN 'DEPENDENTE'
            ELSE 'SEM_TIPO'
          END AS tipo
        FROM ${BENEF} b
        WHERE b.cpf IS NOT NULL AND TRIM(CAST(b.cpf AS STRING)) != ''
        GROUP BY 1
      ),
      deleted_types AS (
        SELECT
          LPAD(REGEXP_REPLACE(CAST(ud.cpf AS STRING), '[^0-9]', ''), 11, '0') AS cpf_norm,
          CASE
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(CAST(ud.data['type_kinship'] AS STRING), ''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'TITULAR'
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(CAST(ud.data['type_kinship'] AS STRING), ''))) NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) = 1 THEN 'DEPENDENTE'
            ELSE 'SEM_TIPO'
          END AS tipo
        FROM ${DELETED} ud
        WHERE ud.cpf IS NOT NULL AND TRIM(CAST(ud.cpf AS STRING)) != ''
        GROUP BY 1
      )
      SELECT
        CASE
          WHEN b.identidade != 'cpf' THEN 'NAO_MAPEAVEL_' || UPPER(b.identidade)
          WHEN b.cpf_norm IS NULL OR b.cpf_norm = '' OR b.cpf_norm = '00000000000' THEN 'CPF_INVALIDO'
          WHEN COALESCE(bt.tipo, dt.tipo) IN ('TITULAR', 'DEPENDENTE') THEN COALESCE(bt.tipo, dt.tipo)
          WHEN COALESCE(bt.tipo, dt.tipo) = 'SEM_TIPO' THEN 'CPF_SEM_TIPO'
          ELSE 'CPF_SEM_CADASTRO'
        END AS bucket,
        COUNT(*) AS sessoes,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_total
      FROM base b
      LEFT JOIN beneficiary_types bt ON bt.cpf_norm = b.cpf_norm
      LEFT JOIN deleted_types dt ON dt.cpf_norm = b.cpf_norm AND bt.tipo IS NULL
      GROUP BY 1
      ORDER BY sessoes DESC
    `,
  },
  {
    label: "5) Sample: chaves de variables na source (confirma origem do CPF)",
    sql: `
      SELECT
        SUM(CASE WHEN NULLIF(REGEXP_REPLACE(CAST(COALESCE(
          variables['cpf'], variables['CPF'], variables['document'], variables['documento'],
          variables['cpf_cnpj'], variables['document_number'], variables['beneficiary_cpf'],
          variables['cpf_beneficiario'], variables['cpf_beneficiary']
        ) AS STRING), '[^0-9]', ''), '') IS NOT NULL THEN 1 ELSE 0 END) AS com_cpf_em_variables,
        SUM(CASE WHEN NULLIF(TRIM(CAST(COALESCE(
          variables['beneficiary_id'], variables['beneficiaryId'], variables['beneficiario_id'],
          variables['id_beneficiario'], variables['user_id'], variables['userId'],
          variables['customer_id'], variables['customerId']
        ) AS STRING)), '') IS NOT NULL THEN 1 ELSE 0 END) AS com_beneficiary_id,
        COUNT(*) AS total
      FROM ${SESSION}
      WHERE creation_time >= ADD_MONTHS(TRUNC(CURRENT_DATE(), 'MM'), -11)
    `,
  },
];

(async () => {
  const { warehouses } = dbApi("get", "/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
  if (!wh) throw new Error("Nenhum SQL warehouse encontrado");
  console.log(`warehouse: ${wh.name} (${wh.state})`);
  for (const q of queries) {
    const t0 = Date.now();
    try {
      const rows = await runQuery(wh.id, q.sql);
      printRows(`${q.label}  (${Date.now() - t0}ms)`, rows);
    } catch (err) {
      console.log(`\n▸ ${q.label}`);
      console.log("    ERRO:", err instanceof Error ? err.message : String(err));
    }
  }
})();
