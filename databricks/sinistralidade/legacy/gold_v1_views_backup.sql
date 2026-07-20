-- Backup das views Gold v1, aposentadas em 2026-07-20.
-- A PREVIEW-gold consome a v2 (rota gold-preview.ts) desde a migração;
-- estas definições ficam aqui apenas para restauração de emergência.

CREATE VIEW sanus_prod.gold_sinistro_evento (
  row_sha256,
  source_file_name,
  ingestion_run_id,
  pipeline_version,
  ingestion_mode,
  ingested_at,
  exported_at,
  numero_conta_medica,
  seq_item,
  numero_nr,
  data_atendimento,
  ano_mes_atendimento,
  competencia_cobranca,
  data_cobranca,
  data_inicio_internacao,
  data_alta,
  operadora,
  codigo_empresa,
  nome_empresa,
  nome_empresa_padronizado,
  codigo_lotacao,
  nome_lotacao,
  codigo_plano,
  plano_usuario,
  codigo_usuario,
  cpf_titular,
  genero_usuario,
  data_nascimento,
  idade_usuario,
  faixa_etaria_usuario,
  parentesco_usuario,
  titularidade_usuario,
  prestador,
  prestador_cpfcnpj,
  especialidade,
  tipo_prestador,
  rede_reembolso,
  tipo_de_custo,
  tipo_acomodacao,
  nome_tratamento,
  cd_operadora,
  descricao_procedimento,
  codcid,
  cid,
  codigo_cid_normalizado,
  tuss_code COMMENT 'Código TUSS mapeado final',
  macrogroup COMMENT 'Classificação macro: MEDICAMENTO, MATERIAL, PROCEDIMENTO',
  grupo_procedimento,
  tipo_evento,
  tipo_risco,
  agrupamento_internacao,
  flag_saude_mental,
  tema_saude_mental,
  mapping_source COMMENT ' manual, llm_suggestion, legacy',
  confidence COMMENT 'Nível de confiança (0.0 a 1.0)',
  qtd_servico,
  sinistro,
  valor_coparticipacao,
  valor_fat_coparticipacao,
  sinistro_liquido_aprox,
  ticket_medio_item,
  duracao_internacao_dias,
  flag_internacao,
  flag_pronto_socorro,
  flag_terapia,
  flag_reembolso,
  flag_estorno,
  flag_data_suspeita)
WITH SCHEMA COMPENSATION
AS SELECT
  -- 8.1 Identificacao e linhagem
  row_sha256                                             AS row_sha256,
  source_file_name                                      AS source_file_name,
  ingestion_run_id                                      AS ingestion_run_id,
  pipeline_version                                      AS pipeline_version,
  ingestion_mode                                        AS ingestion_mode,
  ingested_at                                           AS ingested_at,
  exported_at                                           AS exported_at,
  numero_conta_medica                                   AS numero_conta_medica,
  seq_item                                              AS seq_item,
  numero_nr                                             AS numero_nr,

  -- 8.2 Tempo
  Data_Atendto                                          AS data_atendimento,
  date_format(Data_Atendto, 'yyyy-MM')                  AS ano_mes_atendimento,
  competencia_cobranca                                  AS competencia_cobranca,
  data_cobranca                                         AS data_cobranca,       -- v44: ~94% nula
  data_inicio_internacao                                AS data_inicio_internacao,
  data_alta                                             AS data_alta,

  -- 8.3 Empresa, plano e organizacao
  company                                               AS operadora,          -- hoje sempre 'CNU'
  codigo_empresa                                        AS codigo_empresa,
  nome_empresa                                          AS nome_empresa,
  upper(trim(nome_empresa))                             AS nome_empresa_padronizado,
  codigo_lotacao                                        AS codigo_lotacao,
  nome_lotacao                                          AS nome_lotacao,
  CodigoPlano                                           AS codigo_plano,
  Plano_Usuario                                         AS plano_usuario,

  -- 8.4 Beneficiario (sensivel — preferir agregacoes downstream)
  Codigo_Usuario                                        AS codigo_usuario,
  cpf_titular                                           AS cpf_titular,
  Genero_Usuario                                        AS genero_usuario,
  data_nascimento                                       AS data_nascimento,
  Idade_Usuario                                         AS idade_usuario,
  Faixa_Etaria_Usuario                                  AS faixa_etaria_usuario,
  Parentesco_Usuario                                    AS parentesco_usuario,
  Titularidade_Usuario                                  AS titularidade_usuario,

  -- 8.5 Prestador e atendimento
  Prestador                                             AS prestador,
  cpfcnpj                                               AS prestador_cpfcnpj,
  Especialidade                                         AS especialidade,
  tipo_prestador                                        AS tipo_prestador,
  Rede_Reembolso                                        AS rede_reembolso,
  tipo_de_custo                                         AS tipo_de_custo,
  tipo_acomodacao                                       AS tipo_acomodacao,
  nome_tratamento                                       AS nome_tratamento,

  -- 8.6 Procedimento e classificacao
  cd_Operadora                                          AS cd_operadora,
  Descricao_Procedimento                                AS descricao_procedimento,
  CodCid                                                AS codcid,
  CID                                                   AS cid,
  codigo_cid_normalizado                                AS codigo_cid_normalizado, -- v44: 0% nulo (CID bruto e 86% nulo)
  tuss_code                                             AS tuss_code,
  macrogroup                                            AS macrogroup,
  grupo_procedimento                                    AS grupo_procedimento,
  tipo_evento                                           AS tipo_evento,
  tipo_risco                                            AS tipo_risco,
  agrupamento_internacao                                AS agrupamento_internacao,
  flag_saude_mental                                     AS flag_saude_mental,
  tema_saude_mental                                     AS tema_saude_mental,
  mapping_source                                        AS mapping_source,
  confidence                                            AS confidence,

  -- 8.7 Financeiro e volume (brutos)
  QTD_Servico                                           AS qtd_servico,
  Sinistro                                              AS sinistro,
  valor_coparticipacao                                  AS valor_coparticipacao,
  valor_fat_coparticipacao                              AS valor_fat_coparticipacao,

  -- 8.7 Derivados (regras documentadas)
  -- sinistro liquido aproximado = sinistro - coparticipacao (aprox; documentar)
  (Sinistro - COALESCE(valor_coparticipacao, 0))        AS sinistro_liquido_aprox,
  -- ticket medio por item = sinistro / qtd_servico
  CASE WHEN QTD_Servico IS NULL OR QTD_Servico = 0 THEN NULL
       ELSE Sinistro / QTD_Servico END                  AS ticket_medio_item,
  -- duracao internacao em dias (quando ha datas)
  CASE WHEN data_inicio_internacao IS NOT NULL AND data_alta IS NOT NULL
       THEN datediff(data_alta, data_inicio_internacao)
       ELSE NULL END                                    AS duracao_internacao_dias,
  -- flags analiticas por tipo_evento / campos
  (tipo_evento = 'Internacao')                          AS flag_internacao,
  (tipo_evento = 'Pronto Socorro')                      AS flag_pronto_socorro,
  (tipo_evento = 'Terapia')                             AS flag_terapia,
  (Rede_Reembolso = 'Reembolso')                        AS flag_reembolso,
  (Sinistro < 0)                                        AS flag_estorno,
  -- qualidade: datas corrompidas (ex.: ano 205) ou futuras
  (Data_Atendto < DATE'2019-01-01'
    OR Data_Atendto > current_date())                   AS flag_data_suspeita
FROM hive_metastore.sanus_prod.utilizacao_silver_final;

CREATE VIEW sanus_prod.gold_sinistro_empresa_mes (
  ano_mes_atendimento,
  codigo_empresa,
  nome_empresa_padronizado,
  nome_lotacao,
  qtd_itens,
  sinistro_total,
  coparticipacao_total,
  sinistro_liquido,
  beneficiarios_unicos,
  sinistro_internacao,
  sinistro_reembolso)
WITH SCHEMA COMPENSATION
AS SELECT
  ano_mes_atendimento,
  codigo_empresa,
  nome_empresa_padronizado,
  COALESCE(NULLIF(trim(nome_lotacao), ''), 'Sem lotação')       AS nome_lotacao,
  count(*)                                                      AS qtd_itens,
  round(sum(sinistro), 2)                                       AS sinistro_total,
  round(sum(COALESCE(valor_coparticipacao, 0)), 2)              AS coparticipacao_total,
  round(sum(sinistro_liquido_aprox), 2)                         AS sinistro_liquido,
  count(DISTINCT codigo_usuario)                                AS beneficiarios_unicos,
  round(sum(CASE WHEN flag_internacao THEN sinistro END), 2)    AS sinistro_internacao,
  round(sum(CASE WHEN flag_reembolso THEN sinistro END), 2)     AS sinistro_reembolso
FROM hive_metastore.sanus_prod.gold_sinistro_evento
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3, 4;

CREATE VIEW sanus_prod.gold_sinistro_plano_mes (
  ano_mes_atendimento,
  codigo_plano,
  plano_usuario,
  qtd_itens,
  sinistro_total,
  beneficiarios_unicos,
  custo_por_beneficiario)
WITH SCHEMA COMPENSATION
AS SELECT
  ano_mes_atendimento,
  codigo_plano,
  plano_usuario,
  count(*)                                                      AS qtd_itens,
  round(sum(sinistro), 2)                                       AS sinistro_total,
  count(DISTINCT codigo_usuario)                                AS beneficiarios_unicos,
  round(sum(sinistro) / count(DISTINCT codigo_usuario), 2)      AS custo_por_beneficiario
FROM hive_metastore.sanus_prod.gold_sinistro_evento
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3;

CREATE VIEW sanus_prod.gold_sinistro_prestador_mes (
  ano_mes_atendimento,
  prestador,
  tipo_prestador,
  especialidade,
  qtd_itens,
  sinistro_total,
  beneficiarios_unicos,
  sinistro_internacao)
WITH SCHEMA COMPENSATION
AS SELECT
  ano_mes_atendimento,
  prestador,
  tipo_prestador,
  COALESCE(NULLIF(trim(especialidade), ''), 'Sem especialidade') AS especialidade,
  count(*)                                                      AS qtd_itens,
  round(sum(sinistro), 2)                                       AS sinistro_total,
  count(DISTINCT codigo_usuario)                                AS beneficiarios_unicos,
  round(sum(CASE WHEN flag_internacao THEN sinistro END), 2)    AS sinistro_internacao
FROM hive_metastore.sanus_prod.gold_sinistro_evento
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3, 4;

CREATE VIEW sanus_prod.gold_sinistro_tipo_evento_mes (
  ano_mes_atendimento,
  tipo_evento,
  macrogroup COMMENT 'Classificação macro: MEDICAMENTO, MATERIAL, PROCEDIMENTO',
  qtd_itens,
  sinistro_total,
  coparticipacao_total,
  sinistro_liquido,
  beneficiarios_unicos,
  ticket_medio_item)
WITH SCHEMA COMPENSATION
AS SELECT
  ano_mes_atendimento,
  COALESCE(NULLIF(trim(tipo_evento), ''), 'Sem classificação')  AS tipo_evento,
  macrogroup,
  count(*)                                                      AS qtd_itens,
  round(sum(sinistro), 2)                                       AS sinistro_total,
  round(sum(COALESCE(valor_coparticipacao, 0)), 2)              AS coparticipacao_total,
  round(sum(sinistro_liquido_aprox), 2)                         AS sinistro_liquido,
  count(DISTINCT codigo_usuario)                                AS beneficiarios_unicos,
  round(avg(sinistro), 2)                                       AS ticket_medio_item
FROM hive_metastore.sanus_prod.gold_sinistro_evento
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3;
