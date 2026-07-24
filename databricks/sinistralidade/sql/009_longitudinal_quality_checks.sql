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

SELECT 'grain_mart_internacao_grupo_mes_v2' AS check_name, company_key, month_key, acomodacao_internacao, count(*) AS duplicates
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

-- 3. Reconciliação de pessoas e ADMISSÕES contra cálculo direto na Gold.
--    A admissão (hash sem data) é atribuída ao primeiro mês observado — a
--    mesma regra do mart_internacao_mes_v2.
WITH gold_people AS (
  SELECT company_key, month_key, count(DISTINCT person_key) AS gold_people
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2
), gold_admissions AS (
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
  g.gold_people, p.mart_people, coalesce(ge.gold_episodes, 0) AS gold_episodes, i.mart_episodes
FROM gold_people g
LEFT JOIN gold_episodes ge ON g.company_key = ge.company_key AND g.month_key = ge.month_key
LEFT JOIN pessoa p ON g.company_key = p.company_key AND g.month_key = p.month_key
LEFT JOIN internacao i ON g.company_key = i.company_key AND g.month_key = i.month_key
WHERE coalesce(p.mart_people, 0) <> g.gold_people
   OR coalesce(i.mart_episodes, 0) <> coalesce(ge.gold_episodes, 0);

-- 3b. Reconciliação de CUSTO de internação e de itens de PS contra a Gold.
WITH gold_internacao AS (
  SELECT company_key, min(month_key) AS month_key,
    sha2(concat_ws('||', company_key, person_key,
      coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) AS admission_key,
    sum(custo_assistencial_bruto) AS custo
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita AND flag_internacao
  GROUP BY company_key, 3
), gold_internacao_mes AS (
  SELECT company_key, month_key, round(sum(custo), 2) AS gold_cost
  FROM gold_internacao GROUP BY 1, 2
), mart_internacao AS (
  SELECT company_key, month_key, round(sum(custo_total), 2) AS mart_cost
  FROM hive_metastore.sanus_prod.mart_internacao_mes_v2 GROUP BY 1, 2
), mart_ps AS (
  SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS mart_cost
  FROM hive_metastore.sanus_prod.mart_ps_item_mes_v2 GROUP BY 1, 2
), gold_ps AS (
  SELECT company_key, month_key, round(sum(custo_assistencial_bruto), 2) AS gold_cost
  FROM hive_metastore.sanus_prod.mart_ps_episodio_item_v2 GROUP BY 1, 2
)
SELECT 'hospitalization_ps_cost_reconciliation' AS check_name,
  coalesce(gi.company_key, gp.company_key) AS company_key,
  coalesce(gi.month_key, gp.month_key) AS month_key,
  gi.gold_cost AS internacao_gold, mi.mart_cost AS internacao_mart,
  gp.gold_cost AS ps_gold, mp.mart_cost AS ps_mart
FROM gold_internacao_mes gi
FULL OUTER JOIN mart_internacao mi ON gi.company_key = mi.company_key AND gi.month_key = mi.month_key
FULL OUTER JOIN gold_ps gp ON coalesce(gi.company_key, mi.company_key) = gp.company_key AND coalesce(gi.month_key, mi.month_key) = gp.month_key
FULL OUTER JOIN mart_ps mp ON gp.company_key = mp.company_key AND gp.month_key = mp.month_key
WHERE abs(coalesce(gi.gold_cost, 0) - coalesce(mi.mart_cost, 0)) > 0.05
   OR abs(coalesce(gp.gold_cost, 0) - coalesce(mp.mart_cost, 0)) > 0.05;

-- 3c. Razão admissões × atendimentos-dia: acompanha o efeito da migração de
--     grão; razão média muito próxima de 1 com internações longas indica
--     conta/senha ausentes na origem (chave degradada).
SELECT 'admission_vs_day_ratio' AS check_name, company_key, month_key,
  sum(episodios_internacao) AS admissoes,
  sum(atendimentos_dia) AS atendimentos_dia,
  round(sum(atendimentos_dia) / nullif(sum(episodios_internacao), 0), 4) AS razao
FROM hive_metastore.sanus_prod.mart_internacao_mes_v2
GROUP BY 1, 2, 3
ORDER BY 2, 3;

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
   OR participacao_top10pct > 1.0 + 1e-9
   OR participacao_top10pct + 1e-9 < participacao_top1
   OR pessoas_para_50pct > pessoas_para_80pct;

-- 6b. Estornos: share de linhas com custo negativo por empresa/mês. Reporte
--     de acompanhamento (não bloqueia); alta concentração de estornos indica
--     lote de ajuste retroativo a investigar antes de fechar o mês.
SELECT 'refund_share' AS check_name, company_key, month_key,
  sum(CASE WHEN flag_estorno THEN 1 ELSE 0 END) AS linhas_estorno,
  count(*) AS linhas_total,
  round(avg(CASE WHEN flag_estorno THEN 1.0 ELSE 0.0 END), 4) AS share_estorno,
  round(sum(CASE WHEN flag_estorno THEN custo_assistencial_bruto ELSE 0 END), 2) AS custo_estornado
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3
ORDER BY 2, 3;

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
--    prestador, CID, TUSS e saúde mental (contrato §57).
--    Reporte para publicação, não bloqueio automático.
SELECT 'coverage_report' AS check_name, company_key, month_key,
  count(*) AS linhas,
  round(avg(CASE WHEN person_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_pessoa,
  round(avg(CASE WHEN episode_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_episodio,
  round(avg(CASE WHEN family_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_familia,
  round(avg(CASE WHEN nullif(trim(codigo_procedimento_operadora), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_procedimento,
  round(avg(CASE WHEN nullif(trim(prestador), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_prestador,
  round(avg(CASE WHEN nullif(trim(codigo_cid_normalizado), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_cid,
  round(avg(CASE WHEN nullif(trim(tuss_code), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_tuss,
  round(avg(CASE WHEN flag_saude_mental IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_saude_mental
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

-- 11. (removido em 2026-07-20) Reconciliação Preview Gold × V2: a Gold v1 foi
--     aposentada — a PREVIEW-gold consome a v2 desde a migração da rota, a
--     reconciliação final fechou em R$ 0,00 em todos os meses exceto a linha
--     de data suspeita, e as views v1 foram removidas (backup em
--     databricks/sinistralidade/legacy/gold_v1_views_backup.sql).

-- 12. Execução multiempresa: o conjunto precisa conter mais de uma empresa
--     homologada antes da publicação do benchmark. Reporte de contagem.
SELECT 'company_coverage' AS check_name,
  count(DISTINCT company_key) AS empresas_observadas
FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2;
