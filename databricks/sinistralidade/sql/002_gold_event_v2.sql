-- Fato Gold v2 em shadow mode. A Gold v1 não é modificada.

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.gold_sinistro_evento_v2 AS
WITH base AS (
  SELECT
    s.*,
    -- Classificação NATIVA da operadora (grupo estatístico), trazida da Bronze
    -- por chave 1:1 (source_file_sha256 + source_row_number). Substitui a
    -- classificação enriquecida por LLM (ver VALIDACAO_DADOS_ENRIQUECIDOS.md).
    upper(trim(b.raw_codigo_grupo_estatistico)) AS grupo_estatistico_codigo,
    trim(b.raw_nome_grupo_estatistico) AS grupo_estatistico_nome,
    upper(trim(coalesce(b.raw_eme, 'N'))) AS indicador_emergencia_nativo,
    upper(trim(coalesce(nullif(s.company, ''), 'OPERADORA_NAO_INFORMADA'))) AS operator_name_normalized,
    upper(trim(coalesce(nullif(s.nome_empresa, ''), concat('EMPRESA_', coalesce(s.codigo_empresa, 'NAO_INFORMADA'))))) AS company_name_normalized,
    regexp_replace(coalesce(s.cpf_titular, ''), '[^0-9]', '') AS holder_cpf_digits,
    CASE WHEN s.Codigo_Usuario RLIKE '^[0-9]+$' THEN trim(s.Codigo_Usuario) END AS valid_source_person_id
  FROM hive_metastore.sanus_prod.utilizacao_silver_final s
  LEFT JOIN hive_metastore.sanus_prod.utilizacao_raw_bronze b
    ON s.source_file_sha256 = b.source_file_sha256
   AND s.source_row_number = b.source_row_number
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
  grupo_estatistico_codigo,
  grupo_estatistico_nome,
  -- tipo_evento NATIVO (de-para do grupo estatístico da operadora; sem LLM).
  -- Decisão 2026-07-20 (DE_PARA_TIPO_EVENTO.md): mapeamento conservador ~12 rótulos.
  -- Taxa/Mat/Med foi quebrado (decisão 2026-07-24): o balde único somava ~40%
  -- do custo e escondia a composição. Separado em Medicamento / Material-OPME /
  -- Taxas / Honorário médico. Honorário (HNN+HON = R$24,6M, > Internação) tem
  -- rótulo próprio por ser a maior rubrica isolada. Medicina preventiva
  -- (MPB/MPC) → Consulta.
  CASE
    WHEN grupo_estatistico_codigo IN ('DIG','DIC','DIE') THEN 'Exame'
    WHEN grupo_estatistico_codigo IN ('CEL','CUR','CON','MPB','MPC') THEN 'Consulta'
    WHEN grupo_estatistico_codigo IN ('TER','TNP','MTE','TNF','TF','TNO','TNN','TRS','TEE') THEN 'Terapia'
    WHEN grupo_estatistico_codigo IN ('ONC','QMT','RDT') THEN 'Oncologia Ambulatorial'
    WHEN grupo_estatistico_codigo IN ('DEF','DAP','DUT','DUP','DPE','DSI','DBR','DOT','ISO','THT','PDE','PDA') THEN 'Internacao'
    WHEN grupo_estatistico_codigo IN ('DDH','PDH','DDA','DDE') THEN 'Hospital Dia'
    WHEN grupo_estatistico_codigo IN ('HDC','GHC') THEN 'Home Care'
    WHEN grupo_estatistico_codigo = 'REM' THEN 'Remocao'
    WHEN grupo_estatistico_codigo IN ('MCM','MED','MAC','MIB') THEN 'Medicamento'
    WHEN grupo_estatistico_codigo IN ('MTC','MAT','MES','MOP') THEN 'Material-OPME'
    WHEN grupo_estatistico_codigo IN ('HNN','HON') THEN 'Honorário médico'
    WHEN grupo_estatistico_codigo IN ('TUS','TAS','TEQ','TCC','TOT','TAD','GAS') THEN 'Taxas'
    ELSE 'Sem classificação'
  END AS tipo_evento,
  -- Acomodação nativa para o agrupamento de internação (B5, decisão 2026-07-20).
  CASE
    WHEN grupo_estatistico_codigo IN ('DUT','DUP','DPE','DSI') THEN 'UTI'
    WHEN grupo_estatistico_codigo IN ('DEF','DBR') THEN 'Enfermaria'
    WHEN grupo_estatistico_codigo = 'DAP' THEN 'Apartamento'
    WHEN grupo_estatistico_codigo IN ('DDH','DDA','DDE') THEN 'Day-hospital'
    WHEN grupo_estatistico_codigo IN ('PDE','PDA','PDH') THEN 'Psiquiatria'
    WHEN grupo_estatistico_codigo = 'ISO' THEN 'Isolamento'
    WHEN grupo_estatistico_codigo IN ('THT','DOT') THEN 'Outras diárias'
    WHEN grupo_estatistico_codigo IN ('HDC','GHC') THEN 'Home care'
    ELSE NULL
  END AS acomodacao_internacao,
  -- macrogroup por CAPÍTULO TUSS nativo (interino; rótulo a refinar com a
  -- tabela oficial da ANS). Sem LLM. 28% sem código TUSS = 'Sem TUSS'.
  CASE
    WHEN cd_Operadora NOT RLIKE '^[0-9]{8}$' THEN 'Sem TUSS'
    WHEN substr(cd_Operadora,1,2) = '10' THEN 'Consultas e visitas'
    WHEN substr(cd_Operadora,1,2) IN ('40','28') THEN 'Análises clínicas'
    WHEN substr(cd_Operadora,1,2) = '41' THEN 'Diagnóstico por imagem'
    WHEN substr(cd_Operadora,1,2) IN ('20','70') THEN 'Procedimentos diagnósticos/terapêuticos'
    WHEN substr(cd_Operadora,1,2) IN ('30','31') THEN 'Procedimentos cirúrgicos'
    WHEN substr(cd_Operadora,1,2) = '90' THEN 'Medicamentos'
    WHEN substr(cd_Operadora,1,2) IN ('00','60') THEN 'Materiais e OPME'
    WHEN substr(cd_Operadora,1,2) = '50' THEN 'Atendimento domiciliar/terapias'
    ELSE 'Outros'
  END AS macrogroup,
  grupo_procedimento,
  -- Colunas enriquecidas (LLM) preservadas só para reconciliação/antes-depois.
  tipo_evento AS tipo_evento_llm_legado,
  macrogroup AS macrogroup_llm_legado,
  tipo_risco,
  agrupamento_internacao,
  -- flag_saude_mental NATIVO: regra de palavra-chave (determinística, não IA)
  -- UNIÃO códigos nativos de psiquiatria/psicologia (decisão 2026-07-20).
  coalesce(criterio_saude_mental IS NOT NULL, false)
    OR grupo_estatistico_codigo IN ('PDE','PDA','TNP') AS flag_saude_mental,
  flag_saude_mental AS flag_saude_mental_legado,
  tema_saude_mental,
  criterio_saude_mental,
  indicador_emergencia_nativo,
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
  -- Flags derivados de fonte NATIVA (não do tipo_evento; sem LLM):
  -- internação = diárias plenas; PS = TUSS de consulta-PS ou indicador de
  -- emergência nativo; terapia = grupos de terapia.
  grupo_estatistico_codigo IN ('DEF','DAP','DUT','DUP','DPE','DSI','DBR','DOT','ISO','THT','PDE','PDA') AS flag_internacao,
  (cd_Operadora = '10101039' OR indicador_emergencia_nativo = 'S') AS flag_pronto_socorro,
  grupo_estatistico_codigo IN ('TER','TNP','MTE','TNF','TF','TNO','TNN','TRS','TEE') AS flag_terapia,
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
