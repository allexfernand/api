-- Registra o baseline sem promover nenhum mês a fechado.

MERGE INTO hive_metastore.sanus_prod.sinistralidade_month_status_v2 AS target
USING (
  SELECT company_key, month_key, 'unknown' AS status,
    CAST(NULL AS INT) AS expected_files, CAST(NULL AS INT) AS received_files,
    linhas_cobranca AS silver_rows, linhas_cobranca AS gold_rows,
    custo_assistencial_bruto AS silver_gross_cost, custo_assistencial_bruto AS gold_gross_cost,
    CASE WHEN vidas_elegiveis IS NULL THEN 'snapshot_unavailable_for_month' ELSE 'snapshot_available' END AS eligibility_status,
    'baseline_reconciled_not_business_approved' AS quality_status,
    CAST(NULL AS TIMESTAMP) AS closed_at, CAST(NULL AS STRING) AS approved_by,
    '1.0.0' AS contract_version, current_timestamp() AS updated_at
  FROM hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2
) AS source
ON target.company_key = source.company_key AND target.month_key = source.month_key
WHEN MATCHED AND target.status <> 'closed' THEN UPDATE SET
  target.silver_rows = source.silver_rows, target.gold_rows = source.gold_rows,
  target.silver_gross_cost = source.silver_gross_cost, target.gold_gross_cost = source.gold_gross_cost,
  target.eligibility_status = source.eligibility_status, target.quality_status = source.quality_status,
  target.contract_version = source.contract_version, target.updated_at = source.updated_at
WHEN NOT MATCHED THEN INSERT *;

MERGE INTO hive_metastore.sanus_prod.sinistralidade_quality_run_v2 AS target
USING (
  WITH metrics AS (
    SELECT
      (SELECT count(*) FROM hive_metastore.sanus_prod.utilizacao_silver_final) AS silver_rows,
      (SELECT count(*) FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2) AS gold_rows,
      (SELECT round(sum(Sinistro), 2) FROM hive_metastore.sanus_prod.utilizacao_silver_final) AS silver_cost,
      (SELECT round(sum(custo_assistencial_bruto), 2) FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2) AS gold_cost,
      (SELECT count(*) FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2 WHERE company_key IS NULL) AS missing_company,
      (SELECT avg(CASE WHEN identity_resolution_method = 'fallback_identity' THEN 1.0 ELSE 0.0 END)
       FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2) AS fallback_rate
  )
  SELECT 'gold-v2-baseline-2026-07-16' AS quality_run_id,
    'hive_metastore.sanus_prod.gold_sinistro_evento_v2' AS object_name,
    CAST(NULL AS STRING) AS company_key, CAST(NULL AS STRING) AS month_key,
    check_name, status, observed_value, expected_value, tolerance, details,
    current_timestamp() AS checked_at, '1.0.0' AS contract_version
  FROM metrics LATERAL VIEW STACK(4,
    'row_reconciliation', CASE WHEN silver_rows = gold_rows THEN 'passed' ELSE 'failed' END,
      cast(gold_rows AS DOUBLE), cast(silver_rows AS DOUBLE), cast(0 AS DOUBLE), 'Silver e Gold devem ter o mesmo número de linhas',
    'gross_cost_reconciliation', CASE WHEN silver_cost = gold_cost THEN 'passed' ELSE 'failed' END,
      cast(gold_cost AS DOUBLE), cast(silver_cost AS DOUBLE), cast(0.01 AS DOUBLE), 'Custo bruto reconciliado em centavos',
    'company_key_completeness', CASE WHEN missing_company = 0 THEN 'passed' ELSE 'failed' END,
      cast(missing_company AS DOUBLE), cast(0 AS DOUBLE), cast(0 AS DOUBLE), 'Nenhuma linha publicável sem empresa canônica',
    'fallback_identity_rate', CASE WHEN fallback_rate <= 0.01 THEN 'passed' ELSE 'failed' END,
      cast(fallback_rate AS DOUBLE), cast(0 AS DOUBLE), cast(0.01 AS DOUBLE), 'Fallback de identidade limitado a 1%'
  ) AS check_name, status, observed_value, expected_value, tolerance, details
) AS source
ON target.quality_run_id = source.quality_run_id AND target.check_name = source.check_name
WHEN MATCHED THEN UPDATE SET
  target.status = source.status, target.observed_value = source.observed_value,
  target.expected_value = source.expected_value, target.tolerance = source.tolerance,
  target.details = source.details, target.checked_at = source.checked_at,
  target.contract_version = source.contract_version
WHEN NOT MATCHED THEN INSERT *;
