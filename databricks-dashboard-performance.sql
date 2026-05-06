-- Databricks performance helpers for the dashboard.
-- Run these in a Databricks SQL Warehouse with permission to OPTIMIZE/CREATE tables.

-- 1) Physical optimization on the source Delta tables.
-- Use these when the tables are not configured with Liquid Clustering.
OPTIMIZE hive_metastore.sanus_prod.botmaker_session
ZORDER BY (creation_time, organization_id, economic_group_name);

OPTIMIZE hive_metastore.sanus_prod.atendimento_summarized_gold_live
ZORDER BY (hora_criacao_atendimento, grupo_economico);

ANALYZE TABLE hive_metastore.sanus_prod.botmaker_session COMPUTE STATISTICS
FOR COLUMNS creation_time, organization_id, economic_group_name, finished_by;

ANALYZE TABLE hive_metastore.sanus_prod.atendimento_summarized_gold_live COMPUTE STATISTICS
FOR COLUMNS hora_criacao_atendimento, grupo_economico, tipo_solicitacao;

-- 2) Optional path with Liquid Clustering.
-- If the tables are managed with Liquid Clustering, prefer CLUSTER BY and then OPTIMIZE
-- without ZORDER. Do not combine Liquid Clustering and ZORDER on the same table.
-- ALTER TABLE hive_metastore.sanus_prod.botmaker_session
-- CLUSTER BY (creation_time, organization_id, economic_group_name);
-- OPTIMIZE hive_metastore.sanus_prod.botmaker_session;
--
-- ALTER TABLE hive_metastore.sanus_prod.atendimento_summarized_gold_live
-- CLUSTER BY (hora_criacao_atendimento, grupo_economico);
-- OPTIMIZE hive_metastore.sanus_prod.atendimento_summarized_gold_live;

-- 3) Aggregated gold tables for the dashboard.
-- These are the strongest option for fast filters because the UI reads small monthly aggregates.

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.dashboard_sessions_monthly_gold
USING DELTA
AS
SELECT
  DATE_FORMAT(try_cast(creation_time AS TIMESTAMP), 'yyyy-MM') AS mes,
  CAST(organization_id AS STRING) AS organization_id,
  CASE
    WHEN economic_group_name IS NULL OR TRIM(CAST(economic_group_name AS STRING)) = '' THEN 'Nulos'
    ELSE TRIM(CAST(economic_group_name AS STRING))
  END AS economic_group_name,
  CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
  COUNT(*) AS total_sessions
FROM hive_metastore.sanus_prod.botmaker_session
WHERE creation_time IS NOT NULL
GROUP BY
  DATE_FORMAT(try_cast(creation_time AS TIMESTAMP), 'yyyy-MM'),
  CAST(organization_id AS STRING),
  CASE
    WHEN economic_group_name IS NULL OR TRIM(CAST(economic_group_name AS STRING)) = '' THEN 'Nulos'
    ELSE TRIM(CAST(economic_group_name AS STRING))
  END,
  CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.dashboard_sessions_typification_monthly_gold
USING DELTA
AS
SELECT
  DATE_FORMAT(try_cast(creation_time AS TIMESTAMP), 'yyyy-MM') AS mes,
  CAST(organization_id AS STRING) AS organization_id,
  CASE
    WHEN economic_group_name IS NULL OR TRIM(CAST(economic_group_name AS STRING)) = '' THEN 'Nulos'
    ELSE TRIM(CAST(economic_group_name AS STRING))
  END AS economic_group_name,
  CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
  CASE
    WHEN variables['typification'] IS NULL THEN '(NULO)'
    WHEN TRIM(CAST(variables['typification'] AS STRING)) = '' THEN '(VAZIO/BRANCO)'
    ELSE TRIM(CAST(variables['typification'] AS STRING))
  END AS tipificacao,
  COUNT(*) AS total_sessions
FROM hive_metastore.sanus_prod.botmaker_session
WHERE creation_time IS NOT NULL
GROUP BY
  DATE_FORMAT(try_cast(creation_time AS TIMESTAMP), 'yyyy-MM'),
  CAST(organization_id AS STRING),
  CASE
    WHEN economic_group_name IS NULL OR TRIM(CAST(economic_group_name AS STRING)) = '' THEN 'Nulos'
    ELSE TRIM(CAST(economic_group_name AS STRING))
  END,
  CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END,
  CASE
    WHEN variables['typification'] IS NULL THEN '(NULO)'
    WHEN TRIM(CAST(variables['typification'] AS STRING)) = '' THEN '(VAZIO/BRANCO)'
    ELSE TRIM(CAST(variables['typification'] AS STRING))
  END;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.dashboard_appointments_monthly_gold
USING DELTA
AS
SELECT
  DATE_FORMAT(try_cast(hora_criacao_atendimento AS TIMESTAMP), 'yyyy-MM') AS mes,
  TRIM(CAST(grupo_economico AS STRING)) AS grupo_economico,
  CASE
    WHEN UPPER(assunto) LIKE '%DASA%' THEN 'Exames - DASA'
    WHEN UPPER(assunto) LIKE '%CONEXA%' AND UPPER(assunto) LIKE '%PA%' THEN 'Conexa PA'
    WHEN UPPER(assunto) LIKE '%CONEXA%' THEN 'Conexa Eletiva'
    WHEN UPPER(assunto) LIKE '%DENTIST%' OR UPPER(assunto) LIKE '%ODONTO%'
      OR UPPER(assunto) LIKE '%ENDODONT%' OR UPPER(assunto) LIKE '%ORTODONT%'
      OR UPPER(assunto) LIKE '%PROTESIST%' OR UPPER(assunto) LIKE '%BUCOMAXILO%'
      OR UPPER(assunto) LIKE '%BUCO MAXILO%' OR UPPER(assunto) LIKE '%PERIODONT%' THEN 'Odontologia'
    WHEN UPPER(assunto) LIKE '%PSICOLOG%' OR UPPER(assunto) LIKE '%PSIC_LOG%'
      OR UPPER(assunto) LIKE '%NEUROPSIC%' OR UPPER(assunto) LIKE '%PSICOPEDAG%'
      OR UPPER(assunto) LIKE '%NUTRICION%' OR UPPER(assunto) LIKE '%NUTRI__%'
      OR UPPER(assunto) LIKE '%FISIOTERA%'
      OR UPPER(assunto) LIKE '%FONOAUDIO%' OR UPPER(assunto) LIKE '%FONOTERAPIA%'
      OR UPPER(assunto) LIKE '%TERAPIA OCUPACIONAL%' THEN 'Terapias'
    WHEN tipo_solicitacao = 'Médico' THEN 'Consultas'
    WHEN tipo_solicitacao IN ('Exame', 'Exames') THEN 'Exames'
    ELSE 'Outros'
  END AS tipo_agrupado,
  COUNT(*) AS total_appointments
FROM hive_metastore.sanus_prod.atendimento_summarized_gold_live
WHERE hora_criacao_atendimento IS NOT NULL
  AND UPPER(assunto) NOT IN (
    'ATENDIMENTO WHATSAPP',
    'ATENDIMENTO HUMANO',
    'FORA DE HORÁRIO DE ATENDIMENTO'
  )
  AND LOWER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%http%'
  AND UPPER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%ATENDIMENTO HUMANO%'
  AND UPPER(TRIM(REGEXP_REPLACE(COALESCE(CAST(assunto AS STRING), ''), '[^A-Za-z0-9]+', ' '))) NOT LIKE '%ATENDIMENTO%HUMANO%'
  AND NOT (
    assunto RLIKE '^[A-Z][a-z]+ [A-Z]'
    OR assunto RLIKE '^[A-Z][A-Z]+ [A-Z]'
    OR assunto RLIKE '^ [A-Z]'
  )
GROUP BY
  DATE_FORMAT(try_cast(hora_criacao_atendimento AS TIMESTAMP), 'yyyy-MM'),
  TRIM(CAST(grupo_economico AS STRING)),
  CASE
    WHEN UPPER(assunto) LIKE '%DASA%' THEN 'Exames - DASA'
    WHEN UPPER(assunto) LIKE '%CONEXA%' AND UPPER(assunto) LIKE '%PA%' THEN 'Conexa PA'
    WHEN UPPER(assunto) LIKE '%CONEXA%' THEN 'Conexa Eletiva'
    WHEN UPPER(assunto) LIKE '%DENTIST%' OR UPPER(assunto) LIKE '%ODONTO%'
      OR UPPER(assunto) LIKE '%ENDODONT%' OR UPPER(assunto) LIKE '%ORTODONT%'
      OR UPPER(assunto) LIKE '%PROTESIST%' OR UPPER(assunto) LIKE '%BUCOMAXILO%'
      OR UPPER(assunto) LIKE '%BUCO MAXILO%' OR UPPER(assunto) LIKE '%PERIODONT%' THEN 'Odontologia'
    WHEN UPPER(assunto) LIKE '%PSICOLOG%' OR UPPER(assunto) LIKE '%PSIC_LOG%'
      OR UPPER(assunto) LIKE '%NEUROPSIC%' OR UPPER(assunto) LIKE '%PSICOPEDAG%'
      OR UPPER(assunto) LIKE '%NUTRICION%' OR UPPER(assunto) LIKE '%NUTRI__%'
      OR UPPER(assunto) LIKE '%FISIOTERA%'
      OR UPPER(assunto) LIKE '%FONOAUDIO%' OR UPPER(assunto) LIKE '%FONOTERAPIA%'
      OR UPPER(assunto) LIKE '%TERAPIA OCUPACIONAL%' THEN 'Terapias'
    WHEN tipo_solicitacao = 'Médico' THEN 'Consultas'
    WHEN tipo_solicitacao IN ('Exame', 'Exames') THEN 'Exames'
    ELSE 'Outros'
  END;
