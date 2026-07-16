-- Resolve aliases atuais por nome normalizado. Casos sem match devem ser aprovados
-- explicitamente antes de publicar métricas cruzadas de elegibilidade.

MERGE INTO hive_metastore.sanus_prod.sinistralidade_company_alias_v2 AS target
USING (
  SELECT DISTINCT
    'vw_beneficiarios' AS source_system,
    b.ID_EMPRESA AS source_company_id,
    regexp_replace(upper(trim(b.NOME_CLIENTE)), '[^A-Z0-9]', '') AS source_company_name_normalized,
    g.operator_key,
    g.company_key,
    g.nome_empresa_canonico AS canonical_company_name,
    'auto_name_match' AS status,
    CAST(NULL AS STRING) AS approved_by,
    current_timestamp() AS created_at,
    current_timestamp() AS updated_at
  FROM hive_metastore.sanus_prod.vw_beneficiarios b
  INNER JOIN hive_metastore.sanus_prod.dim_empresa_gold_v2 g
    ON regexp_replace(upper(trim(b.NOME_CLIENTE)), '[^A-Z0-9]', '') =
       regexp_replace(upper(trim(g.nome_empresa_canonico)), '[^A-Z0-9]', '')
) AS source
ON target.source_system = source.source_system
AND coalesce(target.source_company_id, '') = coalesce(source.source_company_id, '')
AND target.source_company_name_normalized = source.source_company_name_normalized
WHEN MATCHED THEN UPDATE SET
  target.operator_key = source.operator_key,
  target.company_key = source.company_key,
  target.canonical_company_name = source.canonical_company_name,
  target.status = source.status,
  target.updated_at = source.updated_at
WHEN NOT MATCHED THEN INSERT *;

-- Snapshot atual para iniciar historização. Não retroage elegibilidade histórica.

MERGE INTO hive_metastore.sanus_prod.beneficiary_eligibility_snapshot_v2 AS target
USING (
  WITH snapshot_source AS (
  SELECT
    current_date() AS snapshot_date,
    coalesce(a.company_key,
      sha2(concat_ws('||', 'CADASTRO_NAO_RESOLVIDO', upper(trim(coalesce(b.NOME_CLIENTE, b.ID_EMPRESA, 'EMPRESA_NAO_INFORMADA')))), 256)) AS company_key,
    sha2(concat_ws('||', coalesce(a.company_key, upper(trim(coalesce(b.NOME_CLIENTE, b.ID_EMPRESA, 'EMPRESA_NAO_INFORMADA')))),
      coalesce(nullif(regexp_replace(b.CPF_BENEFICIARIO, '[^0-9]', ''), ''), b.ID_BENEFICIARIO)), 256) AS person_key,
    CASE WHEN upper(trim(coalesce(TIPO_BENEFICIARIO, ''))) LIKE 'TITULAR%'
      THEN sha2(concat_ws('||', coalesce(a.company_key, upper(trim(coalesce(b.NOME_CLIENTE, b.ID_EMPRESA, 'EMPRESA_NAO_INFORMADA')))),
        coalesce(nullif(regexp_replace(b.CPF_BENEFICIARIO, '[^0-9]', ''), ''), b.ID_BENEFICIARIO)), 256)
    END AS family_key,
    b.ID_EMPRESA AS source_company_id,
    b.ID_BENEFICIARIO AS source_beneficiary_id,
    b.TIPO_BENEFICIARIO AS beneficiary_type,
    b.GRAU_PARENTESCO AS relationship,
    coalesce(b.BENEFICIARIO_ATIVO = 'Sim', false) AS active,
    b.DT_INICIO AS coverage_start_date,
    CAST(NULL AS DATE) AS coverage_end_date,
    to_date(b.DT_NASCIMENTO_BENEFICIARIO) AS birth_date,
    b.SEXO AS sex,
    b.CIDADE AS city,
    b.UF AS state,
    'hive_metastore.sanus_prod.vw_beneficiarios' AS source_table,
    current_timestamp() AS source_ingested_at,
    '1.0.0' AS contract_version,
    current_timestamp() AS created_at
  FROM hive_metastore.sanus_prod.vw_beneficiarios b
  LEFT JOIN hive_metastore.sanus_prod.sinistralidade_company_alias_v2 a
    ON a.source_system = 'vw_beneficiarios'
   AND coalesce(a.source_company_id, '') = coalesce(b.ID_EMPRESA, '')
   AND a.source_company_name_normalized = regexp_replace(upper(trim(b.NOME_CLIENTE)), '[^A-Z0-9]', '')
  )
  SELECT * FROM snapshot_source
  QUALIFY row_number() OVER (
    PARTITION BY snapshot_date, company_key, person_key
    ORDER BY active DESC, source_beneficiary_id
  ) = 1
) AS source
ON target.snapshot_date = source.snapshot_date
AND target.company_key = source.company_key
AND target.person_key = source.person_key
WHEN NOT MATCHED THEN INSERT *;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.fact_elegibilidade_mensal_gold_v2 AS
WITH latest_per_month AS (
  SELECT *,
    row_number() OVER (
      PARTITION BY company_key, person_key, date_format(snapshot_date, 'yyyy-MM')
      ORDER BY snapshot_date DESC
    ) AS rn
  FROM hive_metastore.sanus_prod.beneficiary_eligibility_snapshot_v2
)
SELECT
  date_format(snapshot_date, 'yyyy-MM') AS month_key,
  company_key,
  person_key,
  family_key,
  beneficiary_type,
  relationship,
  active,
  coverage_start_date,
  coverage_end_date,
  CASE WHEN active THEN 1.0 ELSE 0.0 END AS member_month_weight,
  birth_date,
  sex,
  city,
  state,
  snapshot_date,
  contract_version
FROM latest_per_month
WHERE rn = 1;
