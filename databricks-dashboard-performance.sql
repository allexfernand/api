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

-- Base leve para a aba Sessões: uma linha por sessão, já com grupo, empresa,
-- tipificação, Humano/IA por mensagem de agente e chave de beneficiário.
-- Rode/atualize esta tabela antes de publicar a API apontando para ela.
CREATE OR REPLACE TABLE hive_metastore.sanus_prod.dashboard_sessions_base_gold
USING DELTA
AS
WITH session_has_agent AS (
  SELECT
    CAST(session_id AS STRING) AS session_id,
    MAX(CASE WHEN sender_type = 'agent' THEN 1 ELSE 0 END) AS teve_humano
  FROM hive_metastore.sanus_prod.botmaker_message
  GROUP BY CAST(session_id AS STRING)
),
sessions_base AS (
  SELECT
    CAST(s.session_id AS STRING) AS session_id,
    try_cast(s.creation_time AS TIMESTAMP) AS creation_ts,
    DATE_FORMAT(try_cast(s.creation_time AS TIMESTAMP), 'yyyy-MM') AS mes,
    DATE_FORMAT(try_cast(s.creation_time AS TIMESTAMP), 'yyyy-MM-dd') AS dia,
    CAST(s.organization_id AS STRING) AS organization_id,
    NULLIF(TRIM(CAST(o.name AS STRING)), '') AS organization_name,
    CASE
      WHEN s.economic_group_name IS NULL OR TRIM(CAST(s.economic_group_name AS STRING)) = ''
      THEN 'Nulos'
      ELSE TRIM(CAST(s.economic_group_name AS STRING))
    END AS economic_group_name,
    CASE
      WHEN s.variables['typification'] IS NULL THEN '(NULO)'
      WHEN TRIM(CAST(s.variables['typification'] AS STRING)) = '' THEN '(VAZIO/BRANCO)'
      ELSE TRIM(CAST(s.variables['typification'] AS STRING))
    END AS tipificacao,
    CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_finished_by,
    COALESCE(sha.teve_humano, 0) AS teve_humano_agent,
    CASE WHEN COALESCE(sha.teve_humano, 0) = 1 THEN 'Humano' ELSE 'IA' END AS tipo_atendimento_agent,
    COALESCE(
      CASE
        WHEN NULLIF(TRIM(CAST(COALESCE(
          s.variables['beneficiary_id'],
          s.variables['beneficiaryId'],
          s.variables['beneficiario_id'],
          s.variables['id_beneficiario'],
          s.variables['user_id'],
          s.variables['userId'],
          s.variables['customer_id'],
          s.variables['customerId']
        ) AS STRING)), '') IS NOT NULL
        THEN CONCAT('beneficiary:', NULLIF(TRIM(CAST(COALESCE(
          s.variables['beneficiary_id'],
          s.variables['beneficiaryId'],
          s.variables['beneficiario_id'],
          s.variables['id_beneficiario'],
          s.variables['user_id'],
          s.variables['userId'],
          s.variables['customer_id'],
          s.variables['customerId']
        ) AS STRING)), ''))
      END,
      CASE
        WHEN NULLIF(REGEXP_REPLACE(CAST(COALESCE(
          s.variables['cpf'],
          s.variables['CPF'],
          s.variables['document'],
          s.variables['documento'],
          s.variables['cpf_cnpj'],
          s.variables['document_number'],
          s.variables['beneficiary_cpf'],
          s.variables['cpf_beneficiario'],
          s.variables['cpf_beneficiary']
        ) AS STRING), '[^0-9]', ''), '') IS NOT NULL
        THEN CONCAT('cpf:', NULLIF(REGEXP_REPLACE(CAST(COALESCE(
          s.variables['cpf'],
          s.variables['CPF'],
          s.variables['document'],
          s.variables['documento'],
          s.variables['cpf_cnpj'],
          s.variables['document_number'],
          s.variables['beneficiary_cpf'],
          s.variables['cpf_beneficiario'],
          s.variables['cpf_beneficiary']
        ) AS STRING), '[^0-9]', ''), ''))
      END
    ) AS beneficiary_key,
    CURRENT_TIMESTAMP() AS refreshed_at
  FROM hive_metastore.sanus_prod.botmaker_session s
  LEFT JOIN hive_metastore.sanus_prod.organizations o
    ON CAST(s.organization_id AS STRING) = CAST(o.id AS STRING)
  LEFT JOIN session_has_agent sha
    ON CAST(s.session_id AS STRING) = sha.session_id
  WHERE s.creation_time IS NOT NULL
)
SELECT *
FROM sessions_base;

OPTIMIZE hive_metastore.sanus_prod.dashboard_sessions_base_gold
ZORDER BY (mes, economic_group_name, organization_name);

ANALYZE TABLE hive_metastore.sanus_prod.dashboard_sessions_base_gold COMPUTE STATISTICS
FOR COLUMNS mes, dia, economic_group_name, organization_name, organization_id, tipo_atendimento_agent, tipo_finished_by, tipificacao;

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
    WHEN UPPER(assunto) LIKE '%DASA%' THEN 'Exames'
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
    WHEN UPPER(assunto) LIKE '%DASA%' THEN 'Exames'
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
