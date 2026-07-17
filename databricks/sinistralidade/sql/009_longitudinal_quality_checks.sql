-- Sinistralidade v2 · checks longitudinais (read-only, contrato 1.1.0).
-- Gates de publicação dos marts criados em 008_longitudinal_marts.sql.
-- Nenhuma consulta aqui altera estado; o registro do resultado é feito por
-- 010_longitudinal_baseline.sql.

-- 1. Unicidade de grão por mart. Esperado: zero linhas em todas as consultas.
SELECT 'grain_mart_evento_empresa_mes_v2' AS check_name, company_key, month_key, tipo_evento, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT 'grain_mart_pessoa_mes_v2' AS check_name, company_key, month_key, person_key, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT 'grain_mart_procedimento_mes_v2' AS check_name, company_key, month_key, procedimento_key, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_procedimento_mes_v2
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT 'grain_mart_internacao_mes_v2' AS check_name, company_key, month_key, saude_mental, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_internacao_mes_v2
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT 'grain_mart_internacao_grupo_mes_v2' AS check_name, company_key, month_key, agrupamento_internacao, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_internacao_grupo_mes_v2
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT 'grain_mart_prestador_mes_v2' AS check_name, company_key, month_key, prestador_key, reembolso, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_prestador_mes_v2
GROUP BY 1, 2, 3, 4, 5 HAVING count(*) > 1;

SELECT 'grain_mart_concentracao_mes_v2' AS check_name, company_key, month_key, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_concentracao_mes_v2
GROUP BY 1, 2, 3 HAVING count(*) > 1;

SELECT 'grain_mart_ps_item_mes_v2' AS check_name, company_key, month_key, procedimento_key, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_ps_item_mes_v2
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT 'grain_mart_familia_mes_relativo_v2' AS check_name, company_key, coorte_entrada, mes_relativo, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_familia_mes_relativo_v2
GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

SELECT 'grain_mart_coordenacao_empresa_mes_v2' AS check_name, company_key, month_key, utilizou_plano, teve_coordenacao, count(*) AS duplicates
FROM hive_metastore.sanus_prod.mart_coordenacao_empresa_mes_v2
GROUP BY 1, 2, 3, 4, 5 HAVING count(*) > 1;

-- 2. Reconciliação de custo por empresa/mês entre marts e a Gold.
--    Tolerância monetária: R$ 0,05 por par empresa+mês (arredondamentos).
WITH gold AS (
  SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS gold_cost
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2
), evento AS (
  SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
  FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2
  GROUP BY 1, 2
), pessoa AS (
  SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
  FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2
  GROUP BY 1, 2
), procedimento AS (
  SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
  FROM hive_metastore.sanus_prod.mart_procedimento_mes_v2
  GROUP BY 1, 2
), prestador AS (
  SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
  FROM hive_metastore.sanus_prod.mart_prestador_mes_v2
  GROUP BY 1, 2
)
SELECT 'cost_reconciliation' AS check_name, g.company_key, g.month_key,
  g.gold_cost,
  e.mart_cost AS evento_cost,
  p.mart_cost AS pessoa_cost,
  pr.mart_cost AS procedimento_cost,
  ps.mart_cost AS prestador_cost
FROM gold g
LEFT JOIN evento e ON g.company_key = e.company_key AND g.month_key = e.month_key
LEFT JOIN pessoa p ON g.company_key = p.company_key AND g.month_key = p.month_key
LEFT JOIN procedimento pr ON g.company_key = pr.company_key AND g.month_key = pr.month_key
LEFT JOIN prestador ps ON g.company_key = ps.company_key AND g.month_key = ps.month_key
WHERE abs(coalesce(e.mart_cost, 0) - g.gold_cost) > 0.05
   OR abs(coalesce(p.mart_cost, 0) - g.gold_cost) > 0.05
   OR abs(coalesce(pr.mart_cost, 0) - g.gold_cost) > 0.05
   OR abs(coalesce(ps.mart_cost, 0) - g.gold_cost) > 0.05;

-- 3. Reconciliação de pessoas e episódios contra cálculo direto na Gold.
WITH gold AS (
  SELECT company_key, month_key,
    count(DISTINCT person_key) AS gold_people,
    count(DISTINCT CASE WHEN flag_internacao THEN episode_key END) AS gold_episodes
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2
), pessoa AS (
  SELECT company_key, month_key, count(DISTINCT person_key) AS mart_people
  FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2
  GROUP BY 1, 2
), internacao AS (
  SELECT company_key, month_key, sum(episodios_internacao) AS mart_episodes
  FROM hive_metastore.sanus_prod.mart_internacao_mes_v2
  GROUP BY 1, 2
)
SELECT 'people_episode_reconciliation' AS check_name, g.company_key, g.month_key,
  g.gold_people, p.mart_people, g.gold_episodes, i.mart_episodes
FROM gold g
LEFT JOIN pessoa p ON g.company_key = p.company_key AND g.month_key = p.month_key
LEFT JOIN internacao i ON g.company_key = i.company_key AND g.month_key = i.month_key
WHERE coalesce(p.mart_people, 0) <> g.gold_people
   OR coalesce(i.mart_episodes, 0) <> g.gold_episodes;

-- 4. Participação por evento deve somar ~100% em cada empresa/mês com custo.
SELECT 'event_share_totals' AS check_name, company_key, month_key,
  round(sum(participacao_custo_mes), 4) AS total_share
FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2
GROUP BY 1, 2, 3
HAVING abs(sum(participacao_custo_mes) - 1.0) > 0.001 AND sum(custo_assistencial_bruto) <> 0;

-- 5. Nenhuma empresa ou mês nulo em nenhum mart longitudinal.
SELECT 'null_keys' AS check_name, source_mart, count(*) AS null_rows FROM (
  SELECT 'evento' AS source_mart, company_key, month_key FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2
  UNION ALL SELECT 'pessoa', company_key, month_key FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2
  UNION ALL SELECT 'procedimento', company_key, month_key FROM hive_metastore.sanus_prod.mart_procedimento_mes_v2
  UNION ALL SELECT 'internacao', company_key, month_key FROM hive_metastore.sanus_prod.mart_internacao_mes_v2
  UNION ALL SELECT 'internacao_grupo', company_key, month_key FROM hive_metastore.sanus_prod.mart_internacao_grupo_mes_v2
  UNION ALL SELECT 'prestador', company_key, month_key FROM hive_metastore.sanus_prod.mart_prestador_mes_v2
  UNION ALL SELECT 'concentracao', company_key, month_key FROM hive_metastore.sanus_prod.mart_concentracao_mes_v2
  UNION ALL SELECT 'ps_item', company_key, month_key FROM hive_metastore.sanus_prod.mart_ps_item_mes_v2
  UNION ALL SELECT 'coordenacao', company_key, month_key FROM hive_metastore.sanus_prod.mart_coordenacao_empresa_mes_v2
)
WHERE company_key IS NULL OR month_key IS NULL
GROUP BY 1, 2;

-- 6. Concentração consistente: shares monotônicos e limitados a 100%.
SELECT 'concentration_consistency' AS check_name, company_key, month_key,
  participacao_top1, participacao_top5, participacao_top10, participacao_top10pct,
  pessoas_para_50pct, pessoas_para_80pct
FROM hive_metastore.sanus_prod.mart_concentracao_mes_v2
WHERE participacao_top1 > participacao_top5 + 1e-9
   OR participacao_top5 > participacao_top10 + 1e-9
   OR participacao_top10 > 1.0 + 1e-9
   OR pessoas_para_50pct > pessoas_para_80pct;

-- 7. Densidade: meses observados na Gold precisam existir nos marts mensais.
WITH gold_months AS (
  SELECT DISTINCT company_key, month_key
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
)
SELECT 'series_density' AS check_name, g.company_key, g.month_key
FROM gold_months g
LEFT JOIN (SELECT DISTINCT company_key, month_key FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2) e
  ON g.company_key = e.company_key AND g.month_key = e.month_key
LEFT JOIN (SELECT DISTINCT company_key, month_key FROM hive_metastore.sanus_prod.mart_concentracao_mes_v2) c
  ON g.company_key = c.company_key AND g.month_key = c.month_key
WHERE e.month_key IS NULL OR c.month_key IS NULL;

-- 8. Cobertura por empresa/mês: pessoa, episódio, família, procedimento,
--    prestador e CID. Reporte para publicação, não bloqueio automático.
SELECT 'coverage_report' AS check_name, company_key, month_key,
  count(*) AS linhas,
  round(avg(CASE WHEN person_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_pessoa,
  round(avg(CASE WHEN episode_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_episodio,
  round(avg(CASE WHEN family_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_familia,
  round(avg(CASE WHEN nullif(trim(codigo_procedimento_operadora), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_procedimento,
  round(avg(CASE WHEN nullif(trim(prestador), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_prestador,
  round(avg(CASE WHEN nullif(trim(codigo_cid_normalizado), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_cid
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3;

-- 9. Associação de itens de PS: todo item do mart precisa vir de episódio
--    com pronto-socorro observado na Gold.
SELECT 'ps_item_association' AS check_name, m.company_key, m.month_key, m.procedimento_key
FROM hive_metastore.sanus_prod.mart_ps_item_mes_v2 m
LEFT JOIN (
  SELECT DISTINCT company_key, month_key
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita AND flag_pronto_socorro
) g ON m.company_key = g.company_key AND m.month_key = g.month_key
WHERE g.month_key IS NULL;

-- 10. Denominadores de elegibilidade: meses com utilização sem snapshot
--     contemporâneo devem ficar sem denominador (não retroagir).
SELECT 'eligibility_denominator' AS check_name, m.company_key, m.month_key,
  m.vidas_elegiveis, m.custo_por_vida_elegivel
FROM hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2 m
WHERE m.vidas_elegiveis IS NULL AND m.custo_por_vida_elegivel IS NOT NULL;

-- 11. Reconciliação Preview Gold × V2: mesmo período e mesma definição.
--     A Preview Gold usa a Gold v1; divergências devem ser registradas e
--     explicadas antes de promover a leitura oficial para a V2.
WITH v1 AS (
  SELECT date_format(Data_Atendto, 'yyyy-MM') AS month_key,
    count(*) AS linhas, round(sum(Sinistro), 2) AS custo
  FROM hive_metastore.sanus_prod.gold_sinistro_evento
  GROUP BY 1
), v2 AS (
  SELECT month_key, sum(linhas_cobranca) AS linhas,
    round(sum(custo_assistencial_bruto), 2) AS custo
  FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2
  GROUP BY 1
)
SELECT 'preview_gold_vs_v2' AS check_name,
  coalesce(v1.month_key, v2.month_key) AS month_key,
  v1.linhas AS v1_linhas, v2.linhas AS v2_linhas,
  v1.custo AS v1_custo, v2.custo AS v2_custo,
  round(coalesce(v2.custo, 0) - coalesce(v1.custo, 0), 2) AS diferenca_custo
FROM v1 FULL OUTER JOIN v2 ON v1.month_key = v2.month_key
ORDER BY 2;

-- 12. Execução multiempresa: o conjunto precisa conter mais de uma empresa
--     homologada antes da publicação do benchmark. Reporte de contagem.
SELECT 'company_coverage' AS check_name,
  count(DISTINCT company_key) AS empresas_observadas
FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2;
