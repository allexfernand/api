-- Consultas read-only usadas como gate de publicação.

SELECT 'row_reconciliation' AS check_name,
  (SELECT count(*) FROM hive_metastore.sanus_prod.utilizacao_silver_final) AS silver_value,
  (SELECT count(*) FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2) AS gold_value;

SELECT 'gross_cost_reconciliation' AS check_name,
  (SELECT round(sum(Sinistro), 2) FROM hive_metastore.sanus_prod.utilizacao_silver_final) AS silver_value,
  (SELECT round(sum(custo_assistencial_bruto), 2) FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2) AS gold_value;

SELECT
  company_key,
  month_key,
  count(*) AS rows_total,
  count(DISTINCT row_sha256) AS distinct_rows,
  sum(CASE WHEN person_key IS NULL THEN 1 ELSE 0 END) AS missing_person_key,
  sum(CASE WHEN identity_resolution_method = 'fallback_identity' THEN 1 ELSE 0 END) AS fallback_identity_rows,
  sum(CASE WHEN nullif(trim(tipo_evento), '') IS NULL THEN 1 ELSE 0 END) AS missing_event,
  sum(CASE WHEN nullif(trim(tuss_code), '') IS NULL THEN 1 ELSE 0 END) AS missing_tuss,
  sum(CASE WHEN nullif(trim(codigo_cid_normalizado), '') IS NULL THEN 1 ELSE 0 END) AS missing_cid,
  sum(CASE WHEN flag_data_suspeita THEN 1 ELSE 0 END) AS suspicious_dates,
  round(sum(custo_assistencial_bruto), 2) AS gross_cost
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT
  company_key,
  episode_key,
  count(DISTINCT person_key) AS people,
  count(DISTINCT data_atendimento) AS dates,
  count(DISTINCT prestador) AS providers
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
GROUP BY 1, 2
HAVING people > 1 OR dates > 1 OR providers > 1;
