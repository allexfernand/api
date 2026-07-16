-- Inventaria os arquivos já observados. Não os aprova nem fecha seus meses.

MERGE INTO hive_metastore.sanus_prod.sinistralidade_ingestion_manifest_v2 AS target
USING (
  SELECT
    sha2(concat_ws('||', company_key, month_key,
      coalesce(source_file_sha256, source_file_name, 'SEM_ARQUIVO')), 256) AS manifest_id,
    operator_key, company_key,
    coalesce(source_file_name, 'fonte_legada_sem_nome') AS source_file_name,
    source_file_sha256, month_key AS reference_month,
    CAST(NULL AS BIGINT) AS expected_rows, count(*) AS received_rows,
    CAST(NULL AS DECIMAL(20,2)) AS expected_gross_cost,
    cast(round(sum(custo_assistencial_bruto), 2) AS DECIMAL(20,2)) AS received_gross_cost,
    'observed_unapproved' AS status,
    max(ingested_at) AS received_at, current_timestamp() AS reconciled_at,
    CAST(NULL AS STRING) AS approved_by,
    'Baseline construído a partir da Silver existente; não representa aceite do arquivo de origem.' AS notes,
    current_timestamp() AS created_at
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  GROUP BY operator_key, company_key, month_key, source_file_name, source_file_sha256
) AS source
ON target.manifest_id = source.manifest_id
WHEN MATCHED THEN UPDATE SET
  target.received_rows = source.received_rows,
  target.received_gross_cost = source.received_gross_cost,
  target.received_at = source.received_at,
  target.reconciled_at = source.reconciled_at,
  target.notes = source.notes
WHEN NOT MATCHED THEN INSERT *;
