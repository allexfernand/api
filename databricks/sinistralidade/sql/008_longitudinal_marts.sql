-- Sinistralidade v2 · marts longitudinais (contrato 1.1.0, shadow mode).
--
-- Regras transversais:
--   * fonte única: gold_sinistro_evento_v2 com NOT flag_data_suspeita;
--   * internações = count(DISTINCT admission_key) com flag_internacao — hash de
--     empresa+pessoa+conta+senha+prestador SEM a data (o episode_key da Gold é
--     grão atendimento-dia e inflaria internações longas), nunca linhas;
--   * usuários = count(DISTINCT person_key); famílias = count(DISTINCT family_key) confiável;
--   * nenhuma linha materializa mês sem cobertura: a densidade da série é resolvida
--     pela API dentro da janela consultada, sem transformar ausência em zero;
--   * todos os marts preservam company_key e month_key;
--   * desempates de ranking são determinísticos por chave estável;
--   * nenhum identificador direto (nome, CPF, carteirinha) é exposto.
--
-- Estes objetos permanecem em shadow mode até passarem pelos gates de
-- 009_longitudinal_quality_checks.sql e 010_longitudinal_baseline.sql.

-- ---------------------------------------------------------------------------
-- mart_evento_empresa_mes_v2
-- Grão: company_key + month_key + tipo_evento (normalizado).
-- Finalidade: composição mensal de custo/uso por tipo de evento comercial.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_evento_empresa_mes_v2 AS
WITH event_month AS (
  SELECT
    company_key,
    month_key,
    coalesce(nullif(trim(tipo_evento), ''), 'Sem classificação') AS tipo_evento,
    count(*) AS linhas_cobranca,
    sum(quantidade_servicos) AS quantidade_servicos,
    count(DISTINCT person_key) AS utilizantes,
    count(DISTINCT family_key) AS familias_utilizantes,
    count(DISTINCT CASE WHEN flag_internacao THEN sha2(concat_ws('||', company_key, person_key,
      coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) END) AS episodios_internacao,
    round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
    sum(CASE WHEN coalesce(flag_saude_mental, false) THEN custo_assistencial_bruto ELSE 0 END) AS custo_saude_mental,
    max(ingested_at) AS freshness
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3
)
SELECT
  e.*,
  round(e.custo_assistencial_bruto
    / nullif(sum(e.custo_assistencial_bruto) OVER (PARTITION BY e.company_key, e.month_key), 0), 6) AS participacao_custo_mes,
  '1.1.0' AS contract_version
FROM event_month e;

-- ---------------------------------------------------------------------------
-- mart_pessoa_mes_v2
-- Grão: company_key + month_key + person_key (denso onde há consumo).
-- Finalidade: base longitudinal de beneficiário para rankings por janela,
-- recorrência, sparkline mensal e detalhe individual autorizado.
-- Nenhum identificador direto: person_key é chave opaca.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_pessoa_mes_v2 AS
WITH person_event AS (
  SELECT
    company_key, month_key, person_key,
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
    company_key, month_key, person_key,
    max(family_key) AS family_key,
    count(*) AS linhas_cobranca,
    sum(quantidade_servicos) AS quantidade_servicos,
    round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
    -- Internações no grão de admissão (sem a data no hash) — ver
    -- mart_internacao_mes_v2; admissão que toca o mês conta uma vez no mês.
    count(DISTINCT CASE WHEN flag_internacao THEN sha2(concat_ws('||', company_key, person_key,
      coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) END) AS episodios_internacao,
    count(DISTINCT coalesce(nullif(trim(tipo_evento), ''), 'Sem classificação')) AS eventos_distintos,
    count(DISTINCT prestador) AS prestadores_distintos,
    round(sum(CASE WHEN coalesce(flag_saude_mental, false) THEN custo_assistencial_bruto ELSE 0 END), 2) AS custo_saude_mental,
    round(sum(CASE WHEN flag_reembolso THEN custo_assistencial_bruto ELSE 0 END), 2) AS custo_reembolso,
    -- Demografia da própria linha de evento (classificação do contrato); sem inferência.
    max(faixa_etaria_usuario) AS faixa_etaria,
    max(parentesco_usuario) AS parentesco,
    max(genero_usuario) AS genero,
    max(CASE WHEN nullif(trim(codigo_cid_normalizado), '') IS NOT NULL THEN 1 ELSE 0 END) = 1 AS possui_cid_valido
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3
)
SELECT
  p.*,
  e.tipo_evento AS evento_principal,
  '1.1.0' AS contract_version
FROM person_month p
LEFT JOIN primary_event e
  ON p.company_key = e.company_key AND p.month_key = e.month_key
 AND p.person_key = e.person_key AND e.rn = 1;

-- ---------------------------------------------------------------------------
-- mart_procedimento_mes_v2
-- Grão: company_key + month_key + codigo_procedimento_operadora.
-- Finalidade: rankings e séries de procedimentos/serviços, separando linhas
-- de cobrança, quantidade de serviços e episódios para evitar dupla leitura.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_procedimento_mes_v2 AS
SELECT
  company_key,
  month_key,
  coalesce(nullif(trim(codigo_procedimento_operadora), ''), 'SEM_CODIGO') AS procedimento_key,
  max(coalesce(nullif(trim(descricao_procedimento), ''), 'Sem descrição')) AS descricao_comercial,
  max(coalesce(nullif(trim(macrogroup), ''), 'Sem classificação')) AS grupo_comercial,
  max(coalesce(nullif(trim(grupo_procedimento), ''), 'Sem classificação')) AS grupo_procedimento,
  count(*) AS linhas_cobranca,
  sum(quantidade_servicos) AS quantidade_servicos,
  count(DISTINCT person_key) AS utilizantes,
  count(DISTINCT CASE WHEN flag_internacao THEN sha2(concat_ws('||', company_key, person_key,
      coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) END) AS episodios_internacao,
  round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  round(sum(custo_assistencial_bruto) / nullif(sum(quantidade_servicos), 0), 2) AS custo_medio_por_servico,
  '1.1.0' AS contract_version
FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
WHERE NOT flag_data_suspeita
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- mart_internacao_mes_v2
-- Grão: company_key + month_key + saude_mental (critério flag_saude_mental).
-- Internações contadas por ADMISSÃO distinta (GOV-02): o episode_key da Gold
-- inclui a data de atendimento, então uma internação faturada em várias datas
-- gerava vários "episódios". A admission_key remove a data (empresa + pessoa
-- + conta + senha + prestador) e colapsa a internação clínica. O mês da
-- admissão é o primeiro mês observado. `atendimentos_dia` preserva a
-- contagem antiga (episode_key) para reconciliação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_internacao_mes_v2 AS
WITH admission_base AS (
  -- Classificação no grão de admissão: uma admissão com qualquer linha de
  -- saúde mental é contada uma única vez, como saúde mental.
  SELECT
    company_key,
    sha2(concat_ws('||', company_key, person_key,
      coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) AS admission_key,
    min(month_key) AS month_key,
    max(coalesce(flag_saude_mental, false)) AS saude_mental,
    max(person_key) AS person_key,
    count(DISTINCT episode_key) AS atendimentos_dia,
    max(duracao_internacao_dias) AS duracao_internacao_dias,
    sum(custo_assistencial_bruto) AS custo_admissao
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita AND flag_internacao
  GROUP BY company_key, 2
)
SELECT
  company_key,
  month_key,
  saude_mental,
  count(DISTINCT admission_key) AS episodios_internacao,
  sum(atendimentos_dia) AS atendimentos_dia,
  count(DISTINCT person_key) AS utilizantes,
  round(sum(custo_admissao), 2) AS custo_total,
  round(sum(custo_admissao) / nullif(count(DISTINCT admission_key), 0), 2) AS custo_medio_por_episodio,
  percentile(duracao_internacao_dias, 0.5) AS duracao_mediana_dias,
  percentile(duracao_internacao_dias, 0.9) AS duracao_p90_dias,
  round(avg(CASE WHEN duracao_internacao_dias IS NOT NULL THEN 1.0 ELSE 0.0 END), 4) AS cobertura_duracao,
  '1.1.0' AS contract_version
FROM admission_base
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- mart_internacao_grupo_mes_v2
-- Grão: company_key + month_key + agrupamento_internacao.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_internacao_grupo_mes_v2 AS
WITH admission_base AS (
  -- Agrupamento no grão de ADMISSÃO (ver mart_internacao_mes_v2): usa o
  -- agrupamento dominante por custo para que cada admissão conte uma vez.
  -- A admissão pertence à mesma conta/senha/prestador, então o prestador é
  -- único por definição; prestadores_envolvidos conta admissões da linha.
  SELECT
    company_key,
    sha2(concat_ws('||', company_key, person_key,
      coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) AS admission_key,
    min(month_key) AS month_key,
    max_by(coalesce(nullif(trim(agrupamento_internacao), ''), 'Sem agrupamento'),
      struct(custo_assistencial_bruto, coalesce(nullif(trim(agrupamento_internacao), ''), 'Sem agrupamento'))) AS agrupamento_internacao,
    max(person_key) AS person_key,
    max(duracao_internacao_dias) AS duracao_internacao_dias,
    count(DISTINCT prestador) AS prestadores_no_episodio,
    sum(custo_assistencial_bruto) AS custo_admissao
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita AND flag_internacao
  GROUP BY company_key, 2
)
SELECT
  company_key,
  month_key,
  agrupamento_internacao,
  count(DISTINCT admission_key) AS episodios_internacao,
  count(DISTINCT person_key) AS utilizantes,
  round(sum(custo_admissao), 2) AS custo_total,
  round(sum(custo_admissao) / nullif(count(DISTINCT admission_key), 0), 2) AS custo_medio_por_episodio,
  percentile(duracao_internacao_dias, 0.5) AS duracao_mediana_dias,
  sum(prestadores_no_episodio) AS prestadores_envolvidos,
  '1.1.0' AS contract_version
FROM admission_base
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- mart_prestador_mes_v2
-- Grão: company_key + month_key + prestador_key + flag_reembolso.
-- prestador_key é opaco (hash empresa+nome normalizado); o rótulo comercial
-- é o nome do prestador, sem CPF/CNPJ.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_prestador_mes_v2 AS
WITH provider_base AS (
  SELECT *,
    sha2(concat_ws('||', company_key,
      upper(trim(coalesce(nullif(prestador, ''), 'PRESTADOR_NAO_INFORMADO')))), 256) AS prestador_key,
    coalesce(flag_reembolso, false) AS reembolso
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
)
SELECT
  company_key,
  month_key,
  prestador_key,
  max(coalesce(nullif(trim(prestador), ''), 'Prestador não informado')) AS prestador_label,
  reembolso,
  max(coalesce(nullif(trim(tipo_prestador), ''), 'Sem classificação')) AS tipo_prestador,
  max(coalesce(nullif(trim(especialidade), ''), 'Sem especialidade')) AS especialidade_principal,
  count(*) AS linhas_cobranca,
  sum(quantidade_servicos) AS quantidade_servicos,
  count(DISTINCT person_key) AS utilizantes,
  count(DISTINCT CASE WHEN flag_internacao THEN sha2(concat_ws('||', company_key, person_key,
      coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256) END) AS episodios_internacao,
  round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  round(sum(custo_assistencial_bruto) / nullif(sum(quantidade_servicos), 0), 2) AS ticket_medio_por_servico,
  round(sum(custo_assistencial_bruto) / nullif(count(DISTINCT person_key), 0), 2) AS custo_medio_por_utilizante,
  '1.1.0' AS contract_version
FROM provider_base
GROUP BY company_key, month_key, prestador_key, reembolso;

-- ---------------------------------------------------------------------------
-- mart_concentracao_mes_v2
-- Grão: company_key + month_key.
-- Top 1/5/10/10%, pessoas para 50%/80% do custo e recorrência do Top 10
-- em relação ao mês imediatamente anterior com consumo observado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_concentracao_mes_v2 AS
WITH person_month AS (
  SELECT
    company_key, month_key, person_key,
    sum(custo_assistencial_bruto) AS custo
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2
  WHERE NOT flag_data_suspeita
  GROUP BY 1, 2, 3
), month_totals AS (
  -- Totais sobre TODAS as pessoas (inclui custo líquido <= 0): é o que
  -- reconcilia com a Gold e serve de denominador das participações.
  SELECT company_key, month_key,
    count(*) AS pessoas_total,
    sum(custo) AS custo_total
  FROM person_month
  GROUP BY 1, 2
), ranked AS (
  -- Estornos: pessoas com custo líquido do mês <= 0 (estorno excede o gasto)
  -- ficam fora do RANKING para manter o acumulado monotônico; os totais do
  -- mês vêm de month_totals, sem filtro.
  SELECT p.*,
    t.pessoas_total,
    t.custo_total,
    row_number() OVER (PARTITION BY p.company_key, p.month_key ORDER BY p.custo DESC, p.person_key) AS rank_custo,
    sum(p.custo) OVER (
      PARTITION BY p.company_key, p.month_key
      ORDER BY p.custo DESC, p.person_key
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS custo_acumulado
  FROM person_month p
  INNER JOIN month_totals t
    ON p.company_key = t.company_key AND p.month_key = t.month_key
  WHERE p.custo > 0
), top10_atual AS (
  SELECT company_key, month_key, person_key FROM ranked WHERE rank_custo <= 10
), month_index AS (
  SELECT DISTINCT company_key, month_key,
    lag(month_key) OVER (PARTITION BY company_key ORDER BY month_key) AS previous_month_key
  FROM person_month
), recurrence AS (
  SELECT
    t.company_key, t.month_key,
    count(*) AS top10_pessoas,
    count(p.person_key) AS top10_recorrentes
  FROM top10_atual t
  INNER JOIN month_index m
    ON t.company_key = m.company_key AND t.month_key = m.month_key
  LEFT JOIN top10_atual p
    ON p.company_key = t.company_key AND p.month_key = m.previous_month_key
   AND p.person_key = t.person_key
  GROUP BY 1, 2
)
SELECT
  r.company_key,
  r.month_key,
  max(r.pessoas_total) AS pessoas_utilizantes,
  round(max(r.custo_total), 2) AS custo_total,
  round(sum(CASE WHEN r.rank_custo <= 1 THEN r.custo ELSE 0 END) / nullif(max(r.custo_total), 0), 6) AS participacao_top1,
  round(sum(CASE WHEN r.rank_custo <= 5 THEN r.custo ELSE 0 END) / nullif(max(r.custo_total), 0), 6) AS participacao_top5,
  round(sum(CASE WHEN r.rank_custo <= 10 THEN r.custo ELSE 0 END) / nullif(max(r.custo_total), 0), 6) AS participacao_top10,
  round(sum(CASE WHEN r.rank_custo <= greatest(1, ceil(r.pessoas_total * 0.10)) THEN r.custo ELSE 0 END)
    / nullif(max(r.custo_total), 0), 6) AS participacao_top10pct,
  min(CASE WHEN r.custo_acumulado >= r.custo_total * 0.50 THEN r.rank_custo END) AS pessoas_para_50pct,
  min(CASE WHEN r.custo_acumulado >= r.custo_total * 0.80 THEN r.rank_custo END) AS pessoas_para_80pct,
  max(coalesce(rec.top10_recorrentes, 0)) AS top10_recorrentes_mes_anterior,
  '1.1.0' AS contract_version
FROM ranked r
LEFT JOIN recurrence rec
  ON r.company_key = rec.company_key AND r.month_key = rec.month_key
GROUP BY 1, 2;

-- ---------------------------------------------------------------------------
-- mart_ps_item_mes_v2
-- Grão: company_key + month_key + procedimento (itens de episódios de PS).
-- Associação explícita ao episode_key com pronto-socorro observado.
-- quantidade_por_episodio evita leitura de item como episódio único.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_ps_item_mes_v2 AS
SELECT
  company_key,
  month_key,
  coalesce(nullif(trim(codigo_procedimento_operadora), ''), 'SEM_CODIGO') AS procedimento_key,
  max(coalesce(nullif(trim(descricao_procedimento), ''), 'Sem descrição')) AS descricao_comercial,
  max(coalesce(nullif(trim(macrogroup), ''), 'Sem classificação')) AS grupo_comercial,
  count(DISTINCT episode_key) AS episodios_ps,
  count(DISTINCT person_key) AS utilizantes,
  sum(linhas_cobranca) AS linhas_cobranca,
  sum(quantidade_servicos) AS quantidade_servicos,
  round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  round(sum(quantidade_servicos) / nullif(count(DISTINCT episode_key), 0), 2) AS quantidade_por_episodio,
  '1.1.0' AS contract_version
FROM hive_metastore.sanus_prod.mart_ps_episodio_item_v2
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- mart_familia_mes_relativo_v2
-- Grão: company_key + coorte de entrada (mês) + mês relativo à entrada.
-- Entrada derivada do snapshot atual (entry_date_source explícito); a ponte
-- de dependentes permanece limitada — cobertura exposta, nunca inferida.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_familia_mes_relativo_v2 AS
WITH entry AS (
  SELECT company_key, family_key, min(coverage_start_date) AS entry_date
  FROM hive_metastore.sanus_prod.beneficiary_eligibility_snapshot_v2
  WHERE family_key IS NOT NULL AND coverage_start_date IS NOT NULL
  GROUP BY 1, 2
), family_month AS (
  SELECT
    g.company_key,
    g.family_key,
    g.month_key,
    count(*) AS linhas_cobranca,
    sum(g.quantidade_servicos) AS quantidade_servicos,
    count(DISTINCT g.person_key) AS pessoas,
    count(DISTINCT CASE WHEN g.flag_internacao THEN sha2(concat_ws('||', g.company_key, g.person_key,
      coalesce(nullif(trim(g.numero_conta_medica), ''), 'SEM_CONTA'),
      coalesce(nullif(trim(g.authorization_id), ''), 'SEM_SENHA'),
      coalesce(nullif(trim(g.prestador), ''), 'SEM_PRESTADOR')), 256) END) AS episodios_internacao,
    sum(g.custo_assistencial_bruto) AS custo_assistencial_bruto,
    max_by(coalesce(nullif(trim(g.tipo_evento), ''), 'Sem classificação'), g.custo_assistencial_bruto) AS evento_principal
  FROM hive_metastore.sanus_prod.gold_sinistro_evento_v2 g
  WHERE NOT g.flag_data_suspeita AND g.family_key IS NOT NULL
  GROUP BY 1, 2, 3
), joined AS (
  SELECT
    f.*,
    date_format(e.entry_date, 'yyyy-MM') AS coorte_entrada,
    cast(months_between(to_date(concat(f.month_key, '-01')), trunc(e.entry_date, 'MM')) AS INT) AS mes_relativo
  FROM family_month f
  INNER JOIN entry e
    ON f.company_key = e.company_key AND f.family_key = e.family_key
)
SELECT
  company_key,
  coorte_entrada,
  mes_relativo,
  count(DISTINCT family_key) AS familias,
  sum(pessoas) AS pessoas_utilizantes,
  sum(linhas_cobranca) AS linhas_cobranca,
  sum(quantidade_servicos) AS quantidade_servicos,
  sum(episodios_internacao) AS episodios_internacao,
  round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  max_by(evento_principal, custo_assistencial_bruto) AS evento_principal,
  'coverage_start_date_from_current_snapshot' AS entry_date_source,
  '1.1.0' AS contract_version
FROM joined
WHERE mes_relativo BETWEEN -12 AND 12
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- mart_coordenacao_empresa_mes_v2
-- Grão: company_key + month_key + quadrante (utilizou_plano × teve_coordenacao).
-- Cortes demográficos permitidos em colunas agregadas; sem exposição individual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hive_metastore.sanus_prod.mart_coordenacao_empresa_mes_v2 AS
SELECT
  company_key,
  month_key,
  utilizou_plano,
  teve_coordenacao,
  count(DISTINCT person_key) AS pessoas,
  count(DISTINCT family_key) AS familias,
  sum(linhas_cobranca) AS linhas_cobranca,
  round(sum(custo_assistencial_bruto), 2) AS custo_assistencial_bruto,
  sum(eventos_coordenacao) AS eventos_coordenacao,
  count(DISTINCT CASE WHEN upper(coalesce(beneficiary_type, '')) LIKE 'TITULAR%' THEN person_key END) AS titulares,
  count(DISTINCT CASE WHEN upper(coalesce(beneficiary_type, '')) NOT LIKE 'TITULAR%' THEN person_key END) AS dependentes,
  count(DISTINCT CASE WHEN coordination_status = 'dependent_without_family_bridge' THEN person_key END) AS pessoas_sem_ponte_familiar,
  '1.1.0' AS contract_version
FROM hive_metastore.sanus_prod.mart_fatura_coordenacao_v2
GROUP BY 1, 2, 3, 4;
