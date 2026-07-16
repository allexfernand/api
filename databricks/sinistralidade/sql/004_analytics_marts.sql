CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2 AS
WITH company_month AS (
SELECT
  company_key,
  operator_key,
  nome_empresa_canonico,
  month_key,
  count(*) AS linhas_cobranca,
  sum(quantidade_servicos) AS quantidade_servicos,
  count(DISTINCT person_key) AS utilizantes,
  count(DISTINCT family_key) AS familias_utilizantes,
  round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  round(sum(valor_coparticipacao), 2) AS coparticipacao,
  round(sum(custo_liquido_aproximado), 2) AS custo_liquido_aproximado,
  sum(CASE WHEN flag_internacao THEN 1 ELSE 0 END) AS linhas_internacao,
  sum(CASE WHEN flag_pronto_socorro THEN 1 ELSE 0 END) AS linhas_pronto_socorro,
  max(ingested_at) AS freshness,
  '1.0.0' AS contract_version
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3, 4
), eligibility AS (
  SELECT company_key, month_key, sum(member_month_weight) AS vidas_elegiveis
  FROM hive_metastore.sanus_prod.fact_elegibilidade_mensal_gold_v2
  GROUP BY 1, 2
)
SELECT c.*,
  round(c.custo_assistencial_bruto / nullif(sum(c.custo_assistencial_bruto) OVER (PARTITION BY c.month_key), 0), 6) AS participacao_custo_mes,
  e.vidas_elegiveis,
  round(c.custo_assistencial_bruto / nullif(e.vidas_elegiveis, 0), 2) AS custo_por_vida_elegivel
FROM company_month c LEFT JOIN eligibility e
  ON c.company_key = e.company_key AND c.month_key = e.month_key;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_top10_mes_v2 AS
WITH person_event AS (
  SELECT company_key, month_key, person_key,
    coalesce(nullif(trim(tipo_evento), ''), 'Sem classificação') AS tipo_evento,
    sum(custo_assistencial_bruto) AS event_cost,
    count(*) AS event_lines
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3, 4
), primary_event AS (
  SELECT *, row_number() OVER (
    PARTITION BY company_key, month_key, person_key
    ORDER BY event_cost DESC, event_lines DESC, tipo_evento
  ) AS rn
  FROM person_event
), person_month AS (
  SELECT
    g.company_key, g.month_key, g.person_key,
    count(*) AS linhas_cobranca,
    sum(g.quantidade_servicos) AS quantidade_servicos,
    sum(g.custo_assistencial_bruto) AS custo_assistencial_bruto,
    count(DISTINCT CASE WHEN g.flag_internacao THEN g.episode_key END) AS internacoes
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2 g
  WHERE NOT g.flag_data_suspeita
  GROUP BY 1, 2, 3
), person_rank AS (
  SELECT p.*, e.tipo_evento AS evento_principal,
    row_number() OVER (PARTITION BY p.company_key, p.month_key ORDER BY p.custo_assistencial_bruto DESC, p.person_key) AS rank_custo,
    row_number() OVER (PARTITION BY p.company_key, p.month_key ORDER BY p.linhas_cobranca DESC, p.person_key) AS rank_linhas,
    row_number() OVER (PARTITION BY p.company_key, p.month_key ORDER BY p.quantidade_servicos DESC, p.person_key) AS rank_quantidade
  FROM person_month p
  LEFT JOIN primary_event e
    ON p.company_key = e.company_key AND p.month_key = e.month_key AND p.person_key = e.person_key AND e.rn = 1
), procedure_month AS (
  SELECT
    company_key, month_key,
    codigo_procedimento_operadora AS entity_key,
    max(descricao_procedimento) AS entity_label,
    count(*) AS linhas_cobranca,
    sum(quantidade_servicos) AS quantidade_servicos,
    sum(custo_assistencial_bruto) AS custo_assistencial_bruto,
    count(DISTINCT person_key) AS utilizantes
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3
), procedure_rank AS (
  SELECT *,
    row_number() OVER (PARTITION BY company_key, month_key ORDER BY custo_assistencial_bruto DESC, entity_key) AS rank_custo,
    row_number() OVER (PARTITION BY company_key, month_key ORDER BY quantidade_servicos DESC, entity_key) AS rank_quantidade
  FROM procedure_month
)
SELECT company_key, month_key, 'person' AS entity_type, person_key AS entity_key,
  concat('Beneficiário ', substr(person_key, 1, 8)) AS entity_label,
  linhas_cobranca, quantidade_servicos, custo_assistencial_bruto, 1 AS utilizantes,
  internacoes, evento_principal, rank_custo, rank_linhas, rank_quantidade, '1.0.0' AS contract_version
FROM person_rank
WHERE least(rank_custo, rank_linhas, rank_quantidade) <= 10
UNION ALL
SELECT company_key, month_key, 'procedure', entity_key, entity_label,
  linhas_cobranca, quantidade_servicos, custo_assistencial_bruto, utilizantes,
  CAST(NULL AS BIGINT), CAST(NULL AS STRING), rank_custo, CAST(NULL AS BIGINT), rank_quantidade, '1.0.0'
FROM procedure_rank
WHERE least(rank_custo, rank_quantidade) <= 10;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_top10_bimestre_v2 AS
WITH person_base AS (
  SELECT
    company_key,
    concat(cast(year(to_date(concat(month_key, '-01'))) AS STRING), '-B',
      cast(ceil(month(to_date(concat(month_key, '-01'))) / 2.0) AS INT)) AS bimester_key,
    person_key AS entity_key,
    sum(custo_assistencial_bruto) AS custo_assistencial_bruto,
    count(*) AS linhas_cobranca,
    sum(quantidade_servicos) AS quantidade_servicos
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3
), procedure_base AS (
  SELECT company_key,
    concat(cast(year(to_date(concat(month_key, '-01'))) AS STRING), '-B',
      cast(ceil(month(to_date(concat(month_key, '-01'))) / 2.0) AS INT)) AS bimester_key,
    codigo_procedimento_operadora AS entity_key,
    sum(custo_assistencial_bruto) AS custo_assistencial_bruto,
    count(*) AS linhas_cobranca,
    sum(quantidade_servicos) AS quantidade_servicos
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3
), unified AS (
  SELECT company_key, bimester_key, 'person' AS entity_type, entity_key,
    custo_assistencial_bruto, linhas_cobranca, quantidade_servicos FROM person_base
  UNION ALL
  SELECT company_key, bimester_key, 'procedure', entity_key,
    custo_assistencial_bruto, linhas_cobranca, quantidade_servicos FROM procedure_base
)
SELECT *,
  row_number() OVER (PARTITION BY company_key, bimester_key, entity_type ORDER BY custo_assistencial_bruto DESC, entity_key) AS rank_custo,
  row_number() OVER (PARTITION BY company_key, bimester_key, entity_type ORDER BY linhas_cobranca DESC, entity_key) AS rank_linhas,
  row_number() OVER (PARTITION BY company_key, bimester_key, entity_type ORDER BY quantidade_servicos DESC, entity_key) AS rank_quantidade,
  '1.0.0' AS contract_version
FROM unified;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_saude_mental_internacao_v2 AS
SELECT
  company_key,
  month_key,
  coalesce(flag_saude_mental, false) AS saude_mental,
  count(DISTINCT episode_key) AS episodios_internacao,
  count(DISTINCT person_key) AS utilizantes,
  round(sum(custo_assistencial_bruto), 2) AS custo_total,
  round(sum(custo_assistencial_bruto) / count(DISTINCT episode_key), 2) AS custo_medio_por_episodio,
  percentile(duracao_internacao_dias, 0.5) AS duracao_mediana_dias,
  percentile(duracao_internacao_dias, 0.9) AS duracao_p90_dias,
  '1.0.0' AS contract_version
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
WHERE NOT flag_data_suspeita AND flag_internacao
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_ps_episodio_item_v2 AS
WITH episodes AS (
  SELECT company_key, episode_key,
    max(CASE WHEN flag_pronto_socorro THEN 1 ELSE 0 END) AS has_ps
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2
)
SELECT
  g.company_key,
  g.month_key,
  g.episode_key,
  g.person_key,
  g.codigo_procedimento_operadora,
  g.descricao_procedimento,
  g.macrogroup,
  g.tipo_evento,
  count(*) AS linhas_cobranca,
  sum(g.quantidade_servicos) AS quantidade_servicos,
  round(sum(g.custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  '1.0.0' AS contract_version
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2 g
INNER JOIN episodes e ON g.company_key = e.company_key AND g.episode_key = e.episode_key AND e.has_ps = 1
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.fact_coordenacao_evento_gold_v2 AS
WITH contacts AS (
  SELECT 'atendimento_gold_live' AS source_system,
    cast(identificacao_atendimento AS STRING) AS source_event_id,
    regexp_replace(upper(trim(nome_conta)), '[^A-Z0-9]', '') AS source_company_name_normalized,
    lpad(regexp_replace(cast(cpf_atendido AS STRING), '[^0-9]', ''), 11, '0') AS cpf_norm,
    to_date(hora_criacao_atendimento) AS event_date,
    coalesce(nullif(trim(assunto), ''), 'Atendimento sem classificação') AS event_type
  FROM hive_metastore.sanus_prod.atendimento_gold_live
  WHERE cpf_atendido IS NOT NULL AND hora_criacao_atendimento IS NOT NULL
  UNION ALL
  SELECT 'healthcoach_gold_live', cast(identificacao_atendimento AS STRING),
    regexp_replace(upper(trim(nome_conta)), '[^A-Z0-9]', ''),
    lpad(regexp_replace(cast(cpf_atendido AS STRING), '[^0-9]', ''), 11, '0'),
    to_date(hora_criacao_atendimento),
    coalesce(nullif(trim(assunto), ''), 'HealthCoach sem classificação')
  FROM hive_metastore.sanus_prod.healthcoach_gold_live
  WHERE cpf_atendido IS NOT NULL AND hora_criacao_atendimento IS NOT NULL
), resolved AS (
  SELECT c.*, a.company_key,
    sha2(concat_ws('||', a.company_key, c.cpf_norm), 256) AS family_key
  FROM contacts c
  INNER JOIN hive_metastore.sanus_prod.sinistralidade_company_alias_v2 a
    ON a.source_company_name_normalized = c.source_company_name_normalized
   AND a.source_system IN (c.source_system, 'vw_beneficiarios')
   AND a.status IN ('auto_name_match', 'approved')
)
SELECT source_system, source_event_id, company_key, family_key, event_date,
  date_format(event_date, 'yyyy-MM') AS month_key, event_type,
  'matched_company_name_and_holder_cpf' AS identity_match_method,
  '1.0.0' AS contract_version
FROM resolved
QUALIFY row_number() OVER (
  PARTITION BY source_system, source_event_id, company_key, family_key
  ORDER BY event_date DESC
) = 1;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_fatura_coordenacao_v2 AS
WITH eligibility AS (
  SELECT month_key, company_key, person_key, family_key, sex, city, state, beneficiary_type
  FROM hive_metastore.sanus_prod.fact_elegibilidade_mensal_gold_v2
  WHERE active
), utilization AS (
  SELECT month_key, company_key, family_key,
    count(*) AS linhas_cobranca,
    sum(custo_assistencial_bruto) AS custo_assistencial_bruto
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3
), coordination AS (
  SELECT month_key, company_key, family_key, count(*) AS eventos_coordenacao
  FROM hive_metastore.sanus_prod.fact_coordenacao_evento_gold_v2
  GROUP BY 1, 2, 3
)
SELECT
  e.month_key, e.company_key, e.person_key, e.family_key,
  e.sex, e.city, e.state, e.beneficiary_type,
  coalesce(u.linhas_cobranca, 0) > 0 AS utilizou_plano,
  coalesce(c.eventos_coordenacao, 0) > 0 AS teve_coordenacao,
  coalesce(c.eventos_coordenacao, 0) AS eventos_coordenacao,
  coalesce(u.linhas_cobranca, 0) AS linhas_cobranca,
  coalesce(u.custo_assistencial_bruto, 0) AS custo_assistencial_bruto,
  CASE WHEN e.family_key IS NULL THEN 'dependent_without_family_bridge'
       ELSE 'holder_cpf_bridge' END AS coordination_status,
  '1.0.0' AS contract_version
FROM eligibility e
LEFT JOIN utilization u
  ON e.month_key = u.month_key AND e.company_key = u.company_key AND e.family_key = u.family_key
LEFT JOIN coordination c
  ON e.month_key = c.month_key AND e.company_key = c.company_key AND e.family_key = c.family_key;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_familia_antes_depois_v2 AS
WITH entry AS (
  SELECT company_key, family_key, min(coverage_start_date) AS entry_date
  FROM hive_metastore.sanus_prod.beneficiary_eligibility_snapshot_v2
  WHERE family_key IS NOT NULL AND coverage_start_date IS NOT NULL
  GROUP BY 1, 2
), family_event AS (
  SELECT g.company_key, g.family_key, g.month_key,
    coalesce(nullif(trim(g.tipo_evento), ''), 'Sem classificação') AS event_type,
    count(*) AS billing_lines, sum(g.quantidade_servicos) AS service_quantity,
    sum(g.custo_assistencial_bruto) AS gross_cost
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2 g
  WHERE NOT g.flag_data_suspeita AND g.family_key IS NOT NULL
  GROUP BY 1, 2, 3, 4
), joined AS (
  SELECT f.*, e.entry_date,
    months_between(to_date(concat(f.month_key, '-01')), trunc(e.entry_date, 'MM')) AS months_from_entry
  FROM family_event f INNER JOIN entry e
    ON f.company_key = e.company_key AND f.family_key = e.family_key
), ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY company_key, family_key,
      CASE WHEN months_from_entry < 0 THEN 'before' ELSE 'after' END
    ORDER BY gross_cost DESC, billing_lines DESC, event_type
  ) AS event_rank
  FROM joined WHERE months_from_entry BETWEEN -6 AND 5
)
SELECT company_key, family_key, entry_date,
  CASE WHEN months_from_entry < 0 THEN 'before' ELSE 'after' END AS phase,
  cast(months_from_entry AS INT) AS months_from_entry,
  month_key, event_type, billing_lines, service_quantity, round(gross_cost, 2) AS gross_cost,
  event_rank = 1 AS primary_event_in_phase,
  'coverage_start_date_from_current_snapshot' AS entry_date_source,
  '1.0.0' AS contract_version
FROM ranked;

CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_comparativo_semestral_v2 AS
WITH month_base AS (
  SELECT m.*, coalesce(s.status, 'unknown') AS month_status
  FROM hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2 m
  LEFT JOIN hive_metastore.sanus_prod.sinistralidade_month_status_v2 s
    ON m.company_key = s.company_key AND m.month_key = s.month_key
  WHERE month(to_date(concat(m.month_key, '-01'))) BETWEEN 1 AND 6
)
SELECT company_key, year(to_date(concat(month_key, '-01'))) AS comparison_year,
  sum(linhas_cobranca) AS sinistros, sum(quantidade_servicos) AS itens,
  round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  count(DISTINCT month_key) AS observed_months,
  sum(CASE WHEN month_status = 'closed' THEN 1 ELSE 0 END) AS closed_months,
  CASE WHEN count(DISTINCT month_key) = 6
        AND sum(CASE WHEN month_status = 'closed' THEN 1 ELSE 0 END) = 6
       THEN 'publishable' ELSE 'blocked_incomplete_or_unapproved' END AS publication_status,
  '1.0.0' AS contract_version
FROM month_base
GROUP BY 1, 2;
