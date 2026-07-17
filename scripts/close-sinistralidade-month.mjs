// Fechamento formal de mês da sinistralidade v2 (GOV-03).
//
// O mês só vira `closed` por manifest e reconciliação, nunca por heurística.
// Este script materializa esse processo:
//   1. valida que todos os arquivos do manifest da empresa+mês estão
//      reconciliados/aprovados (ou aprova explicitamente com --approve-manifest);
//   2. reconcilia linhas e custo da Gold v2 com o registrado no month_status;
//   3. exige que a última rodada de qualidade não tenha check reprovado;
//   4. só então marca `closed`, com closed_at e approved_by auditáveis.
//
// Uso:
//   node scripts/close-sinistralidade-month.mjs --company=<company_key> --month=YYYY-MM --approved-by="Nome" [--apply] [--approve-manifest]
//
// Sem --apply é dry-run: mostra cada verificação e o que seria alterado.

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [key, ...rest] = a.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  }),
);

const host = String(process.env.DATABRICKS_HOST || "").replace(/\/$/, "");
const token = process.env.DATABRICKS_TOKEN;
const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
const company = String(args.company || "");
const month = String(args.month || "");
const approvedBy = String(args["approved-by"] || "");
const apply = args.apply === "true";
const approveManifest = args["approve-manifest"] === "true";

if (!/^[a-f0-9]{64}$/i.test(company)) throw new Error("--company deve ser um company_key (sha256).");
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("--month deve ser YYYY-MM.");
if (!approvedBy) throw new Error("--approved-by é obrigatório: fechamento é um ato formal com responsável.");
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

const esc = (s) => String(s).replace(/'/g, "''");
const results = [];
let blocked = false;
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) blocked = true;
  console.log(`${ok ? "✅" : "❌"} ${name}: ${detail}`);
}

// 0. Estado atual do mês
const statusRows = await q(
  `SELECT status, silver_rows, silver_gross_cost FROM ${G}.sinistralidade_month_status_v2
   WHERE company_key = '${company}' AND month_key = '${month}'
   ORDER BY updated_at DESC LIMIT 1`,
);
const currentStatus = statusRows[0] ? String(statusRows[0][0]) : null;
if (!currentStatus) throw new Error("Empresa+mês não existe no month_status: rode o baseline (006) antes de fechar.");
if (currentStatus === "closed") {
  console.log(`Mês ${month} já está closed. Nada a fazer.`);
  process.exit(0);
}
console.log(`Estado atual: ${currentStatus}\n`);

// 1. Manifest: todos os arquivos do mês reconciliados/aprovados.
const manifestRows = await q(
  `SELECT status, count(*) FROM ${G}.sinistralidade_ingestion_manifest_v2
   WHERE company_key = '${company}' AND reference_month = '${month}'
   GROUP BY status`,
);
const manifestByStatus = Object.fromEntries(manifestRows.map((r) => [String(r[0]), Number(r[1])]));
const manifestTotal = Object.values(manifestByStatus).reduce((s, n) => s + n, 0);
const manifestPending = manifestTotal - (manifestByStatus.reconciled || 0) - (manifestByStatus.approved || 0);
if (manifestTotal === 0) {
  check("manifest", false, "nenhum arquivo registrado no manifest para este mês — registre a origem antes de fechar");
} else if (manifestPending > 0 && approveManifest) {
  console.log(`… ${manifestPending} arquivo(s) pendente(s); --approve-manifest informado — serão aprovados por ${approvedBy}${apply ? "" : " (dry-run)"}.`);
  if (apply) {
    await q(
      `UPDATE ${G}.sinistralidade_ingestion_manifest_v2
       SET status = 'approved', approved_by = '${esc(approvedBy)}', reconciled_at = current_timestamp()
       WHERE company_key = '${company}' AND reference_month = '${month}'
         AND status NOT IN ('reconciled', 'approved')`,
    );
  }
  check("manifest", true, `${manifestTotal} arquivo(s); pendentes aprovados explicitamente por ${approvedBy}`);
} else {
  check("manifest", manifestPending === 0, `${manifestTotal} arquivo(s); ${manifestPending} pendente(s) (status: ${JSON.stringify(manifestByStatus)})`);
}

// 2. Reconciliação: Gold v2 do mês bate com o registrado no baseline.
const goldRows = await q(
  `SELECT count(*), round(sum(custo_assistencial_bruto), 2)
   FROM ${G}.gold_sinistro_evento_v2
   WHERE NOT flag_data_suspeita AND company_key = '${company}' AND month_key = '${month}'`,
);
const goldCount = Number(goldRows[0]?.[0] || 0);
const goldCost = Number(goldRows[0]?.[1] || 0);
const baselineRows = Number(statusRows[0]?.[1] || 0);
const baselineCost = Number(statusRows[0]?.[2] || 0);
check(
  "reconciliação linhas",
  goldCount > 0 && goldCount === baselineRows,
  `gold=${goldCount} × baseline=${baselineRows}${goldCount !== baselineRows ? " — mês reprocessado ou baseline desatualizado; rode 006 e reconcilie antes" : ""}`,
);
check(
  "reconciliação custo",
  Math.abs(goldCost - baselineCost) <= 0.05,
  `gold=R$ ${goldCost.toFixed(2)} × baseline=R$ ${baselineCost.toFixed(2)} (tolerância R$ 0,05)`,
);

// 3. Qualidade: última rodada sem check reprovado.
const qualityRows = await q(
  `SELECT quality_run_id, sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), count(*)
   FROM ${G}.sinistralidade_quality_run_v2
   WHERE quality_run_id = (SELECT quality_run_id FROM ${G}.sinistralidade_quality_run_v2 ORDER BY checked_at DESC LIMIT 1)
   GROUP BY quality_run_id`,
);
const runId = qualityRows[0] ? String(qualityRows[0][0]) : null;
const failed = Number(qualityRows[0]?.[1] || 0);
check("qualidade", runId !== null && failed === 0, `run=${runId ?? "nenhuma"}; checks reprovados=${failed}`);

console.log("");
if (blocked) {
  console.log("⛔ Fechamento bloqueado: resolva as pendências acima. Nenhuma alteração foi feita.");
  process.exit(1);
}
if (!apply) {
  console.log(`Dry-run: todas as verificações passaram. Rode novamente com --apply para marcar ${month} como closed (aprovador: ${approvedBy}).`);
  process.exit(0);
}

await q(
  `UPDATE ${G}.sinistralidade_month_status_v2
   SET status = 'closed', closed_at = current_timestamp(), approved_by = '${esc(approvedBy)}',
       quality_status = 'closed_after_reconciliation', updated_at = current_timestamp()
   WHERE company_key = '${company}' AND month_key = '${month}'`,
);
console.log(`🔒 ${month} fechado para a empresa ${company.slice(0, 8)}… por ${approvedBy}.`);
