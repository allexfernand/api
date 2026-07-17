// Homologação de empresa na sinistralidade v2 (GOV-10).
//
// Quando o arquivo de utilização de uma empresa nova chegar à Silver, este
// script gera o relatório de homologação sem nenhum SQL específico por
// empresa:
//   1. inventaria empresas observadas na Gold v2 e o estado de cada uma
//      (alias, manifest, month_status, meses observados);
//   2. roda os gates escopados na empresa candidata: reconciliação de custo
//      dos marts longitudinais, grão, cobertura por mês e identidade fallback;
//   3. com --apply, registra manifest (observed_unapproved) e month_status
//      (unknown) para os pares empresa+mês ainda não inventariados — nunca
//      promove nada a closed nem aprova alias automaticamente.
//
// Uso:
//   node scripts/onboard-sinistralidade-company.mjs                  # inventário geral
//   node scripts/onboard-sinistralidade-company.mjs --company=<key>  # relatório da candidata
//   node scripts/onboard-sinistralidade-company.mjs --company=<key> --apply

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [key, ...rest] = a.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  }),
);

const host = String(process.env.DATABRICKS_HOST || "").replace(/\/$/, "");
const token = process.env.DATABRICKS_TOKEN;
const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
const company = args.company ? String(args.company) : null;
const apply = args.apply === "true";

if (company && !/^[a-f0-9]{64}$/i.test(company)) throw new Error("--company deve ser um company_key (sha256).");
if (!host || !token || !warehouseId) throw new Error("DATABRICKS_HOST, DATABRICKS_TOKEN e DATABRICKS_WAREHOUSE_ID são obrigatórios.");

const G = "hive_metastore.sanus_prod";

async function q(sql) {
  const response = await fetch(`${host}/api/2.0/sql/statements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: "50s", on_wait_timeout: "CONTINUE" }),
  });
  if (!response.ok) throw new Error(`Databricks ${response.status}: ${await response.text()}`);
  let payload = await response.json();
  while (["PENDING", "RUNNING"].includes(payload.status?.state)) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(`${host}/api/2.0/sql/statements/${payload.statement_id}`, { headers: { Authorization: `Bearer ${token}` } });
    payload = await poll.json();
  }
  if (payload.status?.state !== "SUCCEEDED") throw new Error(payload.status?.error?.message || "Consulta falhou.");
  return payload.result?.data_array || [];
}

// ---- Inventário geral: estado de cada empresa observada
const inventory = await q(
  `SELECT d.company_key, d.nome_empresa_canonico, d.operadora, d.linhas_observadas,
     d.primeira_data_observada, d.ultima_data_observada,
     (SELECT count(*) FROM ${G}.sinistralidade_company_alias_v2 a WHERE a.company_key = d.company_key) AS aliases,
     (SELECT count(*) FROM ${G}.sinistralidade_ingestion_manifest_v2 m WHERE m.company_key = d.company_key) AS manifest_rows,
     (SELECT count(*) FROM ${G}.sinistralidade_month_status_v2 s WHERE s.company_key = d.company_key) AS status_months,
     (SELECT count(DISTINCT g.month_key) FROM ${G}.gold_sinistro_evento_v2 g
       WHERE g.company_key = d.company_key AND NOT g.flag_data_suspeita) AS observed_months
   FROM ${G}.dim_empresa_gold_v2 d
   ORDER BY d.linhas_observadas DESC`,
);
console.log("Empresas observadas na Gold v2:");
for (const r of inventory) {
  const key = String(r[0]);
  console.log(
    `  ${key.slice(0, 8)}… ${String(r[1])} · ${String(r[2])} · ${Number(r[3]).toLocaleString("pt-BR")} linhas · ` +
    `${r[4]}→${r[5]} · aliases=${r[6]} manifest=${r[7]} month_status=${r[8]}/${r[9]} meses`,
  );
}

if (!company) {
  console.log("\nUse --company=<company_key> para gerar o relatório de homologação de uma candidata.");
  process.exit(0);
}

const candidate = inventory.find((r) => String(r[0]).toLowerCase() === company.toLowerCase());
if (!candidate) throw new Error("company_key não observado na Gold v2 — o arquivo chegou à Silver e foi reprocessado?");

console.log(`\n=== Homologação: ${String(candidate[1])} (${company.slice(0, 8)}…) ===\n`);

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "✅" : "❌"} ${name}: ${detail}`);
}

// 1. Reconciliação de custo dos marts longitudinais escopada na empresa.
const recon = await q(
  `WITH gold AS (
     SELECT month_key, round(sum(custo_assistencial_bruto), 2) c
     FROM ${G}.gold_sinistro_evento_v2 WHERE NOT flag_data_suspeita AND company_key = '${company}' GROUP BY 1
   ), pessoa AS (
     SELECT month_key, round(sum(custo_assistencial_bruto), 2) c
     FROM ${G}.mart_pessoa_mes_v2 WHERE company_key = '${company}' GROUP BY 1
   ), evento AS (
     SELECT month_key, round(sum(custo_assistencial_bruto), 2) c
     FROM ${G}.mart_evento_empresa_mes_v2 WHERE company_key = '${company}' GROUP BY 1
   )
   SELECT count(*) FROM gold g
   LEFT JOIN pessoa p ON g.month_key = p.month_key
   LEFT JOIN evento e ON g.month_key = e.month_key
   WHERE abs(coalesce(p.c, 0) - g.c) > 0.05 OR abs(coalesce(e.c, 0) - g.c) > 0.05`,
);
check("reconciliação de custo (marts × Gold)", Number(recon[0][0]) === 0, `${recon[0][0]} mês(es) divergente(s)`);

// 2. Grão pessoa-mês sem duplicata na empresa.
const grain = await q(
  `SELECT count(*) FROM (
     SELECT month_key, person_key FROM ${G}.mart_pessoa_mes_v2
     WHERE company_key = '${company}' GROUP BY 1, 2 HAVING count(*) > 1
   )`,
);
check("grão pessoa-mês", Number(grain[0][0]) === 0, `${grain[0][0]} duplicata(s)`);

// 3. Identidade: taxa de fallback dentro do limite de 1%.
const fallback = await q(
  `SELECT round(avg(CASE WHEN identity_resolution_method = 'fallback_identity' THEN 1.0 ELSE 0.0 END), 4)
   FROM ${G}.gold_sinistro_evento_v2 WHERE company_key = '${company}'`,
);
const fallbackRate = Number(fallback[0][0] || 0);
check("identidade por fallback", fallbackRate <= 0.01, `${(fallbackRate * 100).toFixed(2)}% (limite 1%)`);

// 4. Cobertura por mês (reporte para o dossiê de homologação).
const coverage = await q(
  `SELECT month_key, count(*),
     round(avg(CASE WHEN nullif(trim(tipo_evento), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 3),
     round(avg(CASE WHEN nullif(trim(tuss_code), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 3),
     round(avg(CASE WHEN nullif(trim(codigo_cid_normalizado), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 3),
     round(avg(CASE WHEN family_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 3)
   FROM ${G}.gold_sinistro_evento_v2
   WHERE NOT flag_data_suspeita AND company_key = '${company}'
   GROUP BY 1 ORDER BY 1`,
);
console.log("\nCobertura por mês (linhas · evento · TUSS · CID · família):");
for (const r of coverage) console.log(`  ${r[0]} · ${r[1]} · ${r[2]} · ${r[3]} · ${r[4]} · ${r[5]}`);

// 5. Pares empresa+mês sem inventário (manifest/month_status).
const missing = await q(
  `SELECT g.month_key,
     max(CASE WHEN s.month_key IS NOT NULL THEN 1 ELSE 0 END) AS has_status,
     count(DISTINCT g.source_file_name) AS files,
     count(*) AS rows_total,
     round(sum(g.custo_assistencial_bruto), 2) AS gross_cost
   FROM ${G}.gold_sinistro_evento_v2 g
   LEFT JOIN ${G}.sinistralidade_month_status_v2 s
     ON s.company_key = g.company_key AND s.month_key = g.month_key
   WHERE NOT g.flag_data_suspeita AND g.company_key = '${company}'
   GROUP BY g.month_key ORDER BY g.month_key`,
);
const uninventoried = missing.filter((r) => Number(r[1]) === 0).map((r) => String(r[0]));
console.log(`\nMeses sem month_status: ${uninventoried.length ? uninventoried.join(", ") : "nenhum"}`);

if (uninventoried.length && apply) {
  await q(
    `MERGE INTO ${G}.sinistralidade_month_status_v2 AS target
     USING (
       SELECT g.company_key, g.month_key, 'unknown' AS status,
         CAST(NULL AS INT) AS expected_files, CAST(NULL AS INT) AS received_files,
         count(*) AS silver_rows, count(*) AS gold_rows,
         round(sum(g.custo_assistencial_bruto), 2) AS silver_gross_cost,
         round(sum(g.custo_assistencial_bruto), 2) AS gold_gross_cost,
         'snapshot_unavailable_for_month' AS eligibility_status,
         'onboarding_observed_not_approved' AS quality_status,
         CAST(NULL AS TIMESTAMP) AS closed_at, CAST(NULL AS STRING) AS approved_by,
         '1.1.0' AS contract_version, current_timestamp() AS updated_at
       FROM ${G}.gold_sinistro_evento_v2 g
       WHERE NOT g.flag_data_suspeita AND g.company_key = '${company}'
         AND g.month_key IN (${uninventoried.map((m) => `'${m}'`).join(",")})
       GROUP BY g.company_key, g.month_key
     ) AS source
     ON target.company_key = source.company_key AND target.month_key = source.month_key
     WHEN NOT MATCHED THEN INSERT *`,
  );
  console.log(`Registrados ${uninventoried.length} mês(es) como 'unknown' no month_status (nunca 'closed').`);
} else if (uninventoried.length) {
  console.log("Dry-run: rode com --apply para registrar esses meses como 'unknown'.");
}

const allPassed = results.every(Boolean);
console.log(`\n${allPassed ? "✅ Gates técnicos aprovados." : "⛔ Gates com falha — corrija antes de prosseguir."}`);
console.log("Próximos passos manuais: aprovar alias em sinistralidade_company_alias_v2, registrar arquivos no manifest,");
console.log("validar legendas de negócio e liberar o company_key em DASHBOARD_AUTH_COMPANY_SCOPES.");
process.exit(allPassed ? 0 : 1);
