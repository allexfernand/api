-- Fato Gold v2 em shadow mode. A Gold v1 não é modificada.

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.gold_sinistro_evento_v2 AS
WITH base AS (
  SELECT
    s.*,
    upper(trim(coalesce(nullif(s.company, ''), 'OPERADORA_NAO_INFORMADA'))) AS operator_name_normalized,
    upper(trim(coalesce(nullif(s.nome_empresa, ''), concat('EMPRESA_', coalesce(s.codigo_empresa, 'NAO_INFORMADA'))))) AS company_name_normalized,
    regexp_replace(coalesce(s.cpf_titular, ''), '[^0-9]', '') AS holder_cpf_digits,
    CASE WHEN s.Codigo_Usuario RLIKE '^[0-9]+$' THEN trim(s.Codigo_Usuario) END AS valid_source_person_id
  FROM hive_metastore.sanus_prod.utilizacao_silver_final s
), identity_map AS (
  SELECT
    operator_name_normalized,
    company_name_normalized AS company_identity,
    holder_cpf_digits,
    data_nascimento,
    upper(trim(coalesce(Genero_Usuario, ''))) AS gender_identity,
    upper(trim(coalesce(Parentesco_Usuario, ''))) AS relationship_identity,
    min(valid_source_person_id) AS resolved_source_person_id
  FROM base
  WHERE valid_source_person_id IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING count(DISTINCT valid_source_person_id) = 1
), resolved AS (
  SELECT
    b.*,
    sha2(concat_ws('||', b.operator_name_normalized), 256) AS operator_key,
    sha2(concat_ws('||', b.operator_name_normalized,
      b.company_name_normalized), 256) AS company_key,
    coalesce(b.valid_source_person_id, m.resolved_source_person_id) AS resolved_source_person_id,
    CASE
      WHEN b.valid_source_person_id IS NOT NULL THEN 'source_id'
      WHEN m.resolved_source_person_id IS NOT NULL THEN 'unique_identity_map'
      ELSE 'fallback_identity'
    END AS identity_resolution_method
  FROM base b
  LEFT JOIN identity_map m
    ON b.operator_name_normalized = m.operator_name_normalized
   AND b.company_name_normalized = m.company_identity
   AND b.holder_cpf_digits = m.holder_cpf_digits
   AND b.data_nascimento <=> m.data_nascimento
   AND upper(trim(coalesce(b.Genero_Usuario, ''))) = m.gender_identity
   AND upper(trim(coalesce(b.Parentesco_Usuario, ''))) = m.relationship_identity
), keyed AS (
  SELECT
    r.*,
    sha2(concat_ws('||', r.company_key,
      coalesce(r.resolved_source_person_id,
        concat('FALLBACK:', r.holder_cpf_digits, ':', coalesce(cast(r.data_nascimento AS STRING), ''), ':',
          upper(trim(coalesce(r.Genero_Usuario, ''))), ':', upper(trim(coalesce(r.Parentesco_Usuario, '')))))), 256) AS person_key,
    sha2(concat_ws('||', r.company_key,
      coalesce(nullif(r.holder_cpf_digits, ''), concat('PERSON:', coalesce(r.resolved_source_person_id, r.row_sha256)))), 256) AS family_key
  FROM resolved r
)
SELECT
  '1.0.0' AS contract_version,
  current_timestamp() AS gold_view_evaluated_at,
  row_sha256,
  operator_key,
  company_key,
  person_key,
  family_key,
  sha2(concat_ws('||', company_key, person_key,
    coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
    coalesce(nullif(trim(Senha), ''), 'SEM_SENHA'),
    coalesce(cast(Data_Atendto AS STRING), 'SEM_DATA'),
    coalesce(nullif(trim(Prestador), ''), 'SEM_PRESTADOR')), 256) AS episode_key,
  identity_resolution_method,
  resolved_source_person_id,
  source_file_name,
  source_file_sha256,
  source_row_number,
  ingestion_run_id,
  pipeline_version,
  ingestion_mode,
  ingested_at,
  exported_at,
  bronze_pipeline_version,
  bronze_ingestion_mode,
  bronze_ingestion_run_id,
  bronze_ingested_at,
  numero_conta_medica,
  Senha AS authorization_id,
  seq_item,
  numero_nr,
  Data_Atendto AS data_atendimento,
  date_format(Data_Atendto, 'yyyy-MM') AS month_key,
  competencia_cobranca,
  data_cobranca,
  data_inicio_internacao,
  data_alta,
  operator_name_normalized AS operadora,
  codigo_empresa,
  nome_empresa,
  company_name_normalized AS nome_empresa_canonico,
  codigo_lotacao,
  nome_lotacao,
  CodigoPlano AS codigo_plano,
  Plano_Usuario AS plano_usuario,
  Genero_Usuario AS genero_usuario,
  data_nascimento,
  Idade_Usuario AS idade_usuario,
  Faixa_Etaria_Usuario AS faixa_etaria_usuario,
  Parentesco_Usuario AS parentesco_usuario,
  Titularidade_Usuario AS titularidade_usuario,
  Prestador AS prestador,
  cpfcnpj AS prestador_cpfcnpj,
  Especialidade AS especialidade,
  tipo_prestador,
  Rede_Reembolso AS rede_reembolso,
  tipo_de_custo,
  tipo_acomodacao,
  nome_tratamento,
  cd_Operadora AS codigo_procedimento_operadora,
  Descricao_Procedimento AS descricao_procedimento,
  mapping_procedure_description,
  CodCid AS codigo_cid_origem,
  CID AS cid_descricao,
  codigo_cid_normalizado,
  tuss_code,
  macrogroup,
  grupo_procedimento,
  tipo_evento,
  tipo_risco,
  agrupamento_internacao,
  flag_saude_mental,
  tema_saude_mental,
  criterio_saude_mental,
  mapping_source,
  confidence AS mapping_confidence,
  QTD_Servico AS quantidade_servicos,
  Sinistro AS custo_assistencial_bruto,
  valor_coparticipacao,
  valor_fat_coparticipacao,
  (Sinistro - coalesce(valor_coparticipacao, 0)) AS custo_liquido_aproximado,
  CASE WHEN QTD_Servico IS NULL OR QTD_Servico = 0 THEN NULL ELSE Sinistro / QTD_Servico END AS custo_medio_por_servico,
  CASE WHEN data_inicio_internacao IS NOT NULL AND data_alta IS NOT NULL
    THEN datediff(data_alta, data_inicio_internacao) END AS duracao_internacao_dias,
  coalesce(tipo_evento = 'Internacao', false) AS flag_internacao,
  coalesce(tipo_evento = 'Pronto Socorro', false) AS flag_pronto_socorro,
  coalesce(tipo_evento = 'Terapia', false) AS flag_terapia,
  coalesce(Rede_Reembolso = 'Reembolso', false) AS flag_reembolso,
  coalesce(Sinistro < 0, false) AS flag_estorno,
  coalesce(Data_Atendto < DATE'2019-01-01' OR Data_Atendto > current_date(), true) AS flag_data_suspeita
FROM keyed;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.dim_empresa_gold_v2 AS
SELECT
  company_key,
  operator_key,
  max(operadora) AS operadora,
  concat_ws(',', sort_array(collect_set(codigo_empresa))) AS codigo_empresa,
  max(nome_empresa_canonico) AS nome_empresa_canonico,
  min(data_atendimento) AS primeira_data_observada,
  max(data_atendimento) AS ultima_data_observada,
  count(*) AS linhas_observadas
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
GROUP BY 1, 2;
