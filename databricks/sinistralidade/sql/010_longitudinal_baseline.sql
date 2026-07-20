-- Sinistralidade v2 · baseline longitudinal (contrato 1.1.0).
-- Registra o resultado dos gates dos marts de 008 em
-- sinistralidade_quality_run_v2. Nunca promove mês a 'closed' e não altera
-- month_status: fechamento continua sendo um ato formal de negócio.
--
-- quality_run_id padrão: 'longitudinal-baseline-<data-de-execução>'.
-- Ajuste o literal abaixo ao executar em uma nova data.

MERGE INTO hive_metastore.sanus_prod.sinistralidade_quality_run_v2 AS target
USING (
  WITH gold AS (
    SELECT company_key, month_key,
      round(sum(custo_assistencial_bruto), 2) AS gold_cost,
      count(DISTINCT person_key) AS gold_people
    FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
    WHERE NOT flag_data_suspeita
    GROUP BY 1, 2
  ), gold_admissions AS (
    -- Admissão (hash sem a data), atribuída ao primeiro mês observado —
    -- mesma regra do mart_internacao_mes_v2.
    SELECT company_key, min(month_key) AS month_key,
      sha2(concat_ws('||', company_key, person_key,
        coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
        coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
        coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) AS admission_key
    FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
    WHERE NOT flag_data_suspeita AND flag_internacao
    GROUP BY company_key, 3
  ), gold_episodes AS (
    SELECT company_key, month_key, count(DISTINCT admission_key) AS gold_episodes
    FROM gold_admissions
    GROUP BY 1, 2
  ), metrics AS (
    SELECT
      (SELECT count(*) FROM (
        SELECT company_key, month_key, tipo_evento FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2
        GROUP BY 1, 2, 3 HAVING count(*) > 1
      )) AS evento_grain_violations,
      (SELECT count(*) FROM (
        SELECT company_key, month_key, person_key FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2
        GROUP BY 1, 2, 3 HAVING count(*) > 1
      )) AS pessoa_grain_violations,
      (SELECT count(*) FROM gold g
        LEFT JOIN (
          SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
          FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2 GROUP BY 1, 2
        ) p ON g.company_key = p.company_key AND g.month_key = p.month_key
        WHERE abs(coalesce(p.mart_cost, 0) - g.gold_cost) > 0.05
      ) AS pessoa_cost_divergences,
      (SELECT count(*) FROM gold g
        LEFT JOIN (
          SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
          FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2 GROUP BY 1, 2
        ) e ON g.company_key = e.company_key AND g.month_key = e.month_key
        WHERE abs(coalesce(e.mart_cost, 0) - g.gold_cost) > 0.05
      ) AS evento_cost_divergences,
      (SELECT count(*) FROM gold g
        LEFT JOIN (
          SELECT company_key, month_key, count(DISTINCT person_key) AS mart_people
          FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2 GROUP BY 1, 2
        ) p ON g.company_key = p.company_key AND g.month_key = p.month_key
        WHERE coalesce(p.mart_people, 0) <> g.gold_people
      ) AS people_divergences,
      (SELECT count(*) FROM gold_episodes g
        LEFT JOIN (
          SELECT company_key, month_key, sum(episodios_internacao) AS mart_episodes
          FROM hive_metastore.sanus_prod.mart_internacao_mes_v2 GROUP BY 1, 2
        ) i ON g.company_key = i.company_key AND g.month_key = i.month_key
        WHERE coalesce(i.mart_episodes, 0) <> g.gold_episodes
      ) AS episode_divergences,
      (SELECT count(*) FROM gold g
        LEFT JOIN (
          SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
          FROM hive_metastore.sanus_prod.mart_procedimento_mes_v2 GROUP BY 1, 2
        ) pr ON g.company_key = pr.company_key AND g.month_key = pr.month_key
        WHERE abs(coalesce(pr.mart_cost, 0) - g.gold_cost) > 0.05
      ) AS procedimento_cost_divergences,
      (SELECT count(*) FROM gold g
        LEFT JOIN (
          SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
          FROM hive_metastore.sanus_prod.mart_prestador_mes_v2 GROUP BY 1, 2
        ) pv ON g.company_key = pv.company_key AND g.month_key = pv.month_key
        WHERE abs(coalesce(pv.mart_cost, 0) - g.gold_cost) > 0.05
      ) AS prestador_cost_divergences,
      (SELECT count(*) FROM (
        SELECT company_key, month_key
        FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2
        GROUP BY 1, 2
        HAVING abs(sum(participacao_custo_mes) - 1.0) > 0.001 AND sum(custo_assistencial_bruto) <> 0
      )) AS share_violations,
      (SELECT count(*) FROM hive_metastore.sanus_prod.mart_concentracao_mes_v2
        WHERE participacao_top1 > participacao_top5 + 1e-9
           OR participacao_top5 > participacao_top10 + 1e-9
           OR participacao_top10 > 1.0 + 1e-9
           OR participacao_top10pct > 1.0 + 1e-9
           OR participacao_top10pct + 1e-9 < participacao_top1
           OR pessoas_para_50pct > pessoas_para_80pct
      ) AS concentration_violations,
      (SELECT count(DISTINCT company_key) FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2) AS companies_observed
  )
  SELECT 'longitudinal-baseline-2026-07-20-admissao' AS quality_run_id,
    'hive_metastore.sanus_prod.mart_longitudinal_v2' AS object_name,
    CAST(NULL AS STRING) AS company_key, CAST(NULL AS STRING) AS month_key,
    check_name, status, observed_value, expected_value, tolerance, details,
    current_timestamp() AS checked_at, '1.1.0' AS contract_version
  FROM metrics LATERAL VIEW STACK(10,
    'longitudinal_grain_uniqueness',
      CASE WHEN evento_grain_violations + pessoa_grain_violations = 0 THEN 'passed' ELSE 'failed' END,
      cast(evento_grain_violations + pessoa_grain_violations AS DOUBLE), cast(0 AS DOUBLE), cast(0 AS DOUBLE),
      'Grão único em mart_evento_empresa_mes_v2 e mart_pessoa_mes_v2',
    'longitudinal_cost_reconciliation_evento',
      CASE WHEN evento_cost_divergences = 0 THEN 'passed' ELSE 'failed' END,
      cast(evento_cost_divergences AS DOUBLE), cast(0 AS DOUBLE), cast(0.05 AS DOUBLE),
      'Custo por empresa/mês do mart de evento reconcilia com a Gold (tolerância R$ 0,05)',
    'longitudinal_cost_reconciliation_pessoa',
      CASE WHEN pessoa_cost_divergences = 0 THEN 'passed' ELSE 'failed' END,
      cast(pessoa_cost_divergences AS DOUBLE), cast(0 AS DOUBLE), cast(0.05 AS DOUBLE),
      'Custo por empresa/mês do mart de pessoa reconcilia com a Gold (tolerância R$ 0,05)',
    'longitudinal_people_reconciliation',
      CASE WHEN people_divergences = 0 THEN 'passed' ELSE 'failed' END,
      cast(people_divergences AS DOUBLE), cast(0 AS DOUBLE), cast(0 AS DOUBLE),
      'Utilizantes distintos por empresa/mês idênticos ao cálculo direto na Gold',
    'longitudinal_episode_reconciliation',
      CASE WHEN episode_divergences = 0 THEN 'passed' ELSE 'failed' END,
      cast(episode_divergences AS DOUBLE), cast(0 AS DOUBLE), cast(0 AS DOUBLE),
      'Admissões de internação (hash sem data, mês inicial) idênticas à Gold',
    'longitudinal_cost_reconciliation_procedimento',
      CASE WHEN procedimento_cost_divergences = 0 THEN 'passed' ELSE 'failed' END,
      cast(procedimento_cost_divergences AS DOUBLE), cast(0 AS DOUBLE), cast(0.05 AS DOUBLE),
      'Custo por empresa/mês do mart de procedimento reconcilia com a Gold (tolerância R$ 0,05)',
    'longitudinal_cost_reconciliation_prestador',
      CASE WHEN prestador_cost_divergences = 0 THEN 'passed' ELSE 'failed' END,
      cast(prestador_cost_divergences AS DOUBLE), cast(0 AS DOUBLE), cast(0.05 AS DOUBLE),
      'Custo por empresa/mês do mart de prestador reconcilia com a Gold (tolerância R$ 0,05)',
    'longitudinal_event_share_totals',
      CASE WHEN share_violations = 0 THEN 'passed' ELSE 'failed' END,
      cast(share_violations AS DOUBLE), cast(0 AS DOUBLE), cast(0.001 AS DOUBLE),
      'Participação por evento soma 100% por empresa/mês',
    'longitudinal_concentration_consistency',
      CASE WHEN concentration_violations = 0 THEN 'passed' ELSE 'failed' END,
      cast(concentration_violations AS DOUBLE), cast(0 AS DOUBLE), cast(0 AS DOUBLE),
      'Shares de concentração monotônicos e pessoas para 50% <= 80%',
    'longitudinal_multicompany_readiness',
      CASE WHEN companies_observed >= 2 THEN 'passed' ELSE 'blocked_external' END,
      cast(companies_observed AS DOUBLE), cast(2 AS DOUBLE), cast(0 AS DOUBLE),
      'Benchmark entre empresas exige ao menos duas empresas homologadas; bloqueio externo enquanto houver apenas uma'
  ) AS check_name, status, observed_value, expected_value, tolerance, details
) AS source
ON target.quality_run_id = source.quality_run_id AND target.check_name = source.check_name
WHEN MATCHED THEN UPDATE SET
  target.status = source.status, target.observed_value = source.observed_value,
  target.expected_value = source.expected_value, target.tolerance = source.tolerance,
  target.details = source.details, target.checked_at = source.checked_at,
  target.contract_version = source.contract_version
WHEN NOT MATCHED THEN INSERT *;
