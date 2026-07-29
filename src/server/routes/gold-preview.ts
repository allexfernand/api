// api/gold-preview.ts — dados reais para a aba PREVIEW-gold (DAT-176/177)
// Migrada para a base v2 (contrato 1.1.0): fonte gold_sinistro_evento_v2 +
// marts longitudinais. O shape do payload é preservado para o frontend atual.
// Mudanças de base em relação à v1:
//   * identidade por person_key opaco (a reconstrução manual de codigo_usuario
//     ficou obsoleta — a identidade já é resolvida na própria Gold v2);
//   * internações por count(distinct episode_key), não por conta médica;
//   * família por family_key, não por CPF em claro no SQL;
//   * company scope do usuário aplicado em todas as consultas;
//   * nenhuma regra fixa de empresa (ex.: literal AZUL) — multiempresa.
import { getDashboardAuth, rejectMdsAuth, requireBasicAuth } from "../../../lib/basic-auth";
import { escape, getCell, resolveWarehouseId, runQuery, toInt, toNum } from "../../../lib/databricks";
import { setApiCors, setStableCache } from "../../../lib/http";
import { SINISTRALIDADE_CONTRACT_VERSION } from "../../contracts/sinistralidade-v2";
import { companyScopeSql } from "../auth/company-scope";

type ApiRequest = { method?: string; query: Record<string, any>; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

const GOLD = `hive_metastore.sanus_prod.gold_sinistro_evento_v2`;
const MART_EVENTO = `hive_metastore.sanus_prod.mart_evento_empresa_mes_v2`;
const MART_PRESTADOR = `hive_metastore.sanus_prod.mart_prestador_mes_v2`;
const COORDENACAO = `hive_metastore.sanus_prod.fact_coordenacao_evento_gold_v2`;
const SNAPSHOT = `hive_metastore.sanus_prod.beneficiary_eligibility_snapshot_v2`;
const SILVER_FINAL = `hive_metastore.sanus_prod.utilizacao_silver_final`;
const MONTH_STATUS = `hive_metastore.sanus_prod.sinistralidade_month_status_v2`;

const BASE_FILTER = `NOT flag_data_suspeita`;
const JANELA_2024 = `month_key >= '2024-01'`;
const SERIE_INICIO = `'2025-01'`;
// Janelas pareadas da metodologia da aba Análise Sinistro (impacto Sanus)
const IMPACTO_PRE = ["2025-08", "2025-09"];
const IMPACTO_POS = ["2025-10", "2025-11"];
// Comparação mais madura herdada do BI: quatro meses completos de cada lado.
// Mantemos apenas famílias presentes nas duas janelas para reduzir efeito de entrada/saída da carteira.
const MADURO_PRE = ["2025-06", "2025-07", "2025-08", "2025-09"];
const MADURO_POS = ["2025-10", "2025-11", "2025-12", "2026-01"];
const EVENTOS_COMPARAVEIS = ["Pronto Socorro", "Internacao", "Consulta", "Terapia"];
const SINISTRO_MES_MINIMO = 100_000; // abaixo disso o mês é só lag residual, não entra na série

const mesValido = (m: string) => /^\d{4}-\d{2}$/.test(m);
const maskPerson = (key: string) => `Beneficiário ${key.slice(0, 8)}`;

function continuousHospitalizationCte(filtroSql: string) {
  return `WITH hospitalization_rows AS (
    SELECT g.company_key, g.person_key, g.month_key, g.episode_key,
      g.data_inicio_internacao, g.data_alta, g.custo_assistencial_bruto,
      g.duracao_internacao_dias,
      sha2(concat_ws('||', g.company_key, g.person_key,
        coalesce(nullif(trim(g.numero_conta_medica), ''), 'SEM_CONTA'),
        coalesce(nullif(trim(g.authorization_id), ''), 'SEM_SENHA'),
        coalesce(nullif(trim(g.prestador), ''), 'SEM_PRESTADOR')), 256) AS fallback_admission_key
    FROM ${GOLD} g
    WHERE NOT g.flag_data_suspeita AND g.flag_internacao${filtroSql}
  ), dated_intervals AS (
    SELECT DISTINCT company_key, person_key, data_inicio_internacao, data_alta
    FROM hospitalization_rows
    WHERE data_inicio_internacao IS NOT NULL
      AND data_alta IS NOT NULL
      AND data_alta >= data_inicio_internacao
  ), interval_history AS (
    SELECT *, max(data_alta) OVER (
      PARTITION BY company_key, person_key
      ORDER BY data_inicio_internacao, data_alta
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS maior_alta_anterior
    FROM dated_intervals
  ), numbered_intervals AS (
    SELECT *, sum(CASE WHEN maior_alta_anterior IS NULL OR data_inicio_internacao > maior_alta_anterior THEN 1 ELSE 0 END) OVER (
      PARTITION BY company_key, person_key
      ORDER BY data_inicio_internacao, data_alta
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS sequencia_episodio
    FROM interval_history
  ), episode_rows AS (
    SELECT r.*, sha2(concat_ws('||', r.company_key, r.person_key, 'INTERVALO_CONTINUO', cast(i.sequencia_episodio AS STRING)), 256) AS episodio_key
    FROM hospitalization_rows r
    INNER JOIN numbered_intervals i
      ON r.company_key = i.company_key
     AND r.person_key = i.person_key
     AND r.data_inicio_internacao = i.data_inicio_internacao
     AND r.data_alta = i.data_alta
    UNION ALL
    SELECT r.*, r.fallback_admission_key AS episodio_key
    FROM hospitalization_rows r
    WHERE r.data_inicio_internacao IS NULL
       OR r.data_alta IS NULL
       OR r.data_alta < r.data_inicio_internacao
  ), episodes AS (
    SELECT company_key, person_key, episodio_key,
      coalesce(date_format(min(data_inicio_internacao), 'yyyy-MM'), min(month_key)) AS admission_month,
      count(*) AS linhas,
      sum(custo_assistencial_bruto) AS custo,
      coalesce(datediff(max(data_alta), min(data_inicio_internacao)), max(duracao_internacao_dias)) AS duracao_dias
    FROM episode_rows
    GROUP BY 1, 2, 3
  )`;
}

// Serviços Sanus por família (family_key), via ponte já resolvida na
// fact_coordenacao_evento_gold_v2 (empresa + CPF do titular, sem CPF exposto).
// Cobertura: contatos digitais DO TITULAR; dependente atendido digitalmente não casa.
const SERVICOS_SANUS: Record<string, string> = {
  consulta_digital: `SELECT DISTINCT family_key FROM ${COORDENACAO} WHERE source_system = 'atendimento_gold_live' AND event_type LIKE 'Conexa -%Consulta Eletiva%'`,
  ps_digital: `SELECT DISTINCT family_key FROM ${COORDENACAO} WHERE source_system = 'atendimento_gold_live' AND event_type LIKE 'Conexa - PA Digital%'`,
  healthcoach: `SELECT DISTINCT family_key FROM ${COORDENACAO} WHERE source_system = 'healthcoach_gold_live'`,
  // Físicos: uso na rede, direto da Gold v2
  consulta_fisica: `SELECT DISTINCT family_key FROM ${GOLD} WHERE tipo_evento = 'Consulta'`,
  ps_fisico: `SELECT DISTINCT family_key FROM ${GOLD} WHERE flag_pronto_socorro`,
};

function parseMulti(query: Record<string, any>, key: string): string[] {
  const raw = query[key];
  const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].slice(0, 50);
}

// Constrói a cláusula extra de WHERE (prefixo `g.`) a partir dos filtros da querystring.
function buildFiltroSql(query: Record<string, any>) {
  const aplicados: Record<string, string[]> = {};
  const clauses: string[] = [];

  const inClause = (col: string, values: string[]) =>
    `${col} IN (${values.map((v) => `'${escape(v)}'`).join(",")})`;

  const faixa = parseMulti(query, "faixa_etaria");
  if (faixa.length) { aplicados.faixa_etaria = faixa; clauses.push(inClause("g.faixa_etaria_usuario", faixa)); }

  const sexo = parseMulti(query, "sexo");
  if (sexo.length) { aplicados.sexo = sexo; clauses.push(inClause("g.genero_usuario", sexo)); }

  const tipoPlano = parseMulti(query, "tipo_plano");
  if (tipoPlano.length) { aplicados.tipo_plano = tipoPlano; clauses.push(inClause("g.tipo_acomodacao", tipoPlano)); }

  // Cidade/estado vêm do snapshot de elegibilidade (família do titular)
  const cidade = parseMulti(query, "cidade");
  const estado = parseMulti(query, "estado");
  if (cidade.length || estado.length) {
    if (cidade.length) aplicados.cidade = cidade;
    if (estado.length) aplicados.estado = estado;
    const conds = [
      "family_key IS NOT NULL",
      cidade.length ? inClause("upper(trim(city))", cidade.map((c) => c.toUpperCase())) : "",
      estado.length ? inClause("upper(trim(state))", estado.map((e) => e.toUpperCase())) : "",
    ].filter(Boolean).join(" AND ");
    clauses.push(`g.family_key IN (SELECT DISTINCT family_key FROM ${SNAPSHOT} WHERE ${conds})`);
  }

  const servicos = parseMulti(query, "servico_sanus").filter((s) => SERVICOS_SANUS[s]);
  if (servicos.length) {
    aplicados.servico_sanus = servicos;
    // Grupo familiar tocado por QUALQUER um dos serviços selecionados (união)
    clauses.push(`g.family_key IN (${servicos.map((s) => SERVICOS_SANUS[s]).join(" UNION ")})`);
  }

  return { aplicados, filtroSql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "" };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (rejectMdsAuth(req, res)) return;
  const auth = getDashboardAuth(req);
  if (!auth) return;

  try {
    const warehouseId = await resolveWarehouseId();
    const q = (sql: string) => runQuery(warehouseId, sql);

    const { aplicados, filtroSql: filtroUsuario } = buildFiltroSql(req.query);
    const filtroAtivo = filtroUsuario !== "";
    // Company scope do usuário: aplicado no SQL, nunca só na interface.
    const escopo = companyScopeSql(auth, "g.company_key");
    const escopoMart = companyScopeSql(auth, "company_key");
    const filtroSql = `${escopo}${filtroUsuario}`;

    // ---- Fase 1: séries mensais + versão da fonte e gate formal de fechamento.
    // Com filtro ativo, o mart de evento não serve (não tem as colunas de filtro) → gold direto.
    const [mensalTipoRows, mensalGoldRows, statusRows, versaoRows] = await Promise.all([
      q(filtroAtivo
        ? `SELECT g.month_key, COALESCE(NULLIF(trim(g.tipo_evento), ''), 'Sem classificação'), round(sum(g.custo_assistencial_bruto), 2)
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.month_key >= ${SERIE_INICIO}${filtroSql}
           GROUP BY 1, 2 ORDER BY 1`
        : `SELECT month_key, tipo_evento, round(sum(custo_assistencial_bruto), 2)
           FROM ${MART_EVENTO}
           WHERE month_key >= ${SERIE_INICIO}${escopoMart}
           GROUP BY 1, 2 ORDER BY 1`),
      q(`SELECT g.month_key, count(DISTINCT g.person_key), count(*), round(sum(g.custo_assistencial_bruto), 2)
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita AND g.month_key >= ${SERIE_INICIO}${filtroSql}
         GROUP BY 1 ORDER BY 1`),
      q(`WITH observed AS (
           SELECT g.company_key, g.month_key
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.month_key >= ${SERIE_INICIO}${escopo}
           GROUP BY 1, 2
         ), latest_status AS (
           SELECT s.company_key, s.month_key, s.status
           FROM ${MONTH_STATUS} s
           INNER JOIN observed o ON o.company_key = s.company_key AND o.month_key = s.month_key
           QUALIFY row_number() OVER (PARTITION BY s.company_key, s.month_key ORDER BY s.updated_at DESC) = 1
         )
         SELECT o.month_key,
                CASE
                  WHEN count(ls.company_key) = count(o.company_key)
                   AND sum(CASE WHEN ls.status = 'closed' THEN 1 ELSE 0 END) = count(o.company_key) THEN 'closed'
                  WHEN sum(CASE WHEN ls.status = 'partial' THEN 1 ELSE 0 END) > 0 THEN 'partial'
                  ELSE 'unknown'
                END AS status
         FROM observed o
         LEFT JOIN latest_status ls ON ls.company_key = o.company_key AND ls.month_key = o.month_key
         GROUP BY o.month_key ORDER BY o.month_key`),
      q(`SELECT version, timestamp FROM (DESCRIBE HISTORY ${SILVER_FINAL}) ORDER BY version DESC LIMIT 1`),
    ]);

    const mensal = mensalGoldRows.map((r) => ({
      mes: String(getCell(r[0])),
      utilizantes: toInt(r[1]),
      itens: toInt(r[2]),
      sinistro: toNum(r[3]),
    })).filter((m) => mesValido(m.mes)).sort((a, b) => a.mes.localeCompare(b.mes));

    const statusPorMes = new Map(statusRows.map((row) => [String(getCell(row[0])), String(getCell(row[1]) || "unknown")]));
    const relevantes = mensal.filter((m) => m.sinistro >= SINISTRO_MES_MINIMO);
    const fechados = relevantes.filter((m) => statusPorMes.get(m.mes) === "closed");
    const observados = fechados.length ? fechados : relevantes;
    const parciais = relevantes.filter((m) => statusPorMes.get(m.mes) !== "closed").map((m) => m.mes);
    const ultimoFechado = fechados[fechados.length - 1] || null;
    const ultimoFechadoMes = ultimoFechado ? ultimoFechado.mes : null;
    const janela12 = observados.slice(-12).map((m) => m.mes).filter(mesValido);
    const janela12Sql = janela12.map((m) => `'${m}'`).join(",") || `'0000-00'`;
    const janelaInicio = janela12[0] || "2025-04";
    const janelaFim = janela12[janela12.length - 1] || "2026-03";

    const composicao: Record<string, Record<string, number>> = {};
    for (const r of mensalTipoRows) {
      const mes = String(getCell(r[0]));
      if (!mesValido(mes)) continue;
      const tipo = String(getCell(r[1]) || "Sem classificação").trim() || "Sem classificação";
      (composicao[mes] ||= {})[tipo] = (composicao[mes]?.[tipo] || 0) + toNum(r[2]);
    }

    // ---- Fase 2: KPIs, blocos e impacto (dependem da janela 12m)
    const [kpiRows, total24Rows, lotacaoRows, prestadorRows, concRows, intAgrupRows, intStatsRows, smTemaRows, impactoMesRows, impactoEventoRows, triRows, carteiraRows, topUtiRows, facetRows, cidadeRows, maduroRows, servicoRows, proximidadeRows, competenciaRows] = await Promise.all([
      q(`SELECT round(sum(g.custo_assistencial_bruto), 2), count(DISTINCT g.person_key),
                round(sum(CASE WHEN g.flag_reembolso THEN g.custo_assistencial_bruto END), 2),
                count(DISTINCT CASE WHEN g.month_key = '${ultimoFechadoMes ?? ""}' THEN g.person_key END)
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita AND g.month_key IN (${janela12Sql})${filtroSql}`),
      q(`SELECT round(sum(g.custo_assistencial_bruto), 2),
                round(sum(CASE WHEN g.flag_saude_mental THEN g.custo_assistencial_bruto END), 2),
                round(sum(CASE WHEN g.flag_saude_mental IS NULL THEN g.custo_assistencial_bruto END), 2)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.${JANELA_2024}${filtroSql}`),
      q(`SELECT lot, sin, benef, tot FROM (
           SELECT COALESCE(NULLIF(trim(g.nome_lotacao), ''), 'Sem lotação') AS lot,
                  round(sum(g.custo_assistencial_bruto), 2) AS sin,
                  count(DISTINCT g.person_key) AS benef,
                  round(sum(sum(g.custo_assistencial_bruto)) OVER (), 2) AS tot,
                  row_number() OVER (ORDER BY sum(g.custo_assistencial_bruto) DESC) AS rn
           FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.${JANELA_2024}${filtroSql}
           GROUP BY 1
         ) WHERE rn <= 12 ORDER BY sin DESC`),
      q(filtroAtivo
        ? `SELECT p, sin, tot, nprest FROM (
             SELECT g.prestador AS p,
                    round(sum(g.custo_assistencial_bruto), 2) AS sin,
                    round(sum(sum(g.custo_assistencial_bruto)) OVER (), 2) AS tot,
                    count(*) OVER () AS nprest,
                    row_number() OVER (ORDER BY sum(g.custo_assistencial_bruto) DESC) AS rn
             FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.${JANELA_2024}${filtroSql}
             GROUP BY 1
           ) WHERE rn <= 10 ORDER BY sin DESC`
        : `SELECT p, sin, tot, nprest FROM (
             SELECT prestador_label AS p,
                    round(sum(custo_assistencial_bruto), 2) AS sin,
                    round(sum(sum(custo_assistencial_bruto)) OVER (), 2) AS tot,
                    count(*) OVER () AS nprest,
                    row_number() OVER (ORDER BY sum(custo_assistencial_bruto) DESC) AS rn
             FROM ${MART_PRESTADOR} WHERE month_key >= '2024-01'${escopoMart}
             GROUP BY 1
           ) WHERE rn <= 10 ORDER BY sin DESC`),
      // Concentração direta na Gold v2: person_key já é identidade resolvida,
      // sem reconstrução manual de IDs corrompidos.
      q(`WITH u AS (
           SELECT g.person_key AS usuario, sum(g.custo_assistencial_bruto) AS c
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.month_key IN (${janela12Sql})${filtroSql}
           GROUP BY 1
         ), r AS (
           SELECT c, row_number() OVER (ORDER BY c DESC) AS rn,
                  count(*) OVER () AS n, sum(c) OVER () AS tot
           FROM u
         )
         SELECT max(n),
                max(ceil(n * 0.01)),
                round(100 * sum(CASE WHEN rn <= ceil(n * 0.01) THEN c END) / max(tot), 1),
                round(100 * sum(CASE WHEN rn <= ceil(n * 0.05) THEN c END) / max(tot), 1)
         FROM r`),
      q(`SELECT COALESCE(NULLIF(trim(g.acomodacao_internacao), ''), 'Outras diárias') AS agr,
                round(sum(g.custo_assistencial_bruto) / 1e6, 2)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.flag_internacao AND g.${JANELA_2024}${filtroSql}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      q(`${continuousHospitalizationCte(filtroSql)}
         SELECT sum(linhas), count(*), count(DISTINCT person_key), sum(coalesce(duracao_dias, 0)),
           round(sum(custo) / count(*), 0), percentile(duracao_dias, 0.5), percentile(duracao_dias, 0.9)
         FROM episodes WHERE admission_month >= '2024-01'`),
      q(`SELECT COALESCE(NULLIF(trim(g.tema_saude_mental), ''), 'Sem tema') AS tema,
                round(sum(g.custo_assistencial_bruto) / 1e6, 2)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.flag_saude_mental AND g.${JANELA_2024}${filtroSql}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
      q(`SELECT g.month_key, count(*), round(sum(g.custo_assistencial_bruto), 2), count(DISTINCT g.person_key)
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita AND g.month_key IN (${[...IMPACTO_PRE, ...IMPACTO_POS].map((m) => `'${m}'`).join(",")})${filtroSql}
         GROUP BY 1`),
      q(`SELECT CASE WHEN g.month_key IN (${IMPACTO_PRE.map((m) => `'${m}'`).join(",")}) THEN 'before' ELSE 'after' END,
                g.tipo_evento, count(*)
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita
           AND g.month_key IN (${[...IMPACTO_PRE, ...IMPACTO_POS].map((m) => `'${m}'`).join(",")})
           AND g.tipo_evento IN (${EVENTOS_COMPARAVEIS.map((tipo) => `'${tipo}'`).join(",")})${filtroSql}
         GROUP BY 1, 2 ORDER BY 1, 2`),
      q(`SELECT concat('T', quarter(to_date(concat(g.month_key, '-01'))), '/', substr(g.month_key, 3, 2)) AS tri,
                min(g.month_key) AS m0,
                count(DISTINCT g.person_key)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.month_key >= '2025-07'${filtroSql}
         GROUP BY 1 ORDER BY m0`),
      q(`SELECT g.operadora, g.nome_empresa_canonico,
                round(sum(g.custo_assistencial_bruto), 2) AS sin,
                count(DISTINCT g.person_key) AS benef
         FROM ${GOLD} g WHERE ${BASE_FILTER} AND g.${JANELA_2024}${escopo}
         GROUP BY 1, 2 ORDER BY sin DESC`),
      // Dado sensível (LGPD): ranking individual mascarado por person_key opaco;
      // sem atributos clínicos individuais; endpoint já recusa credencial MDS.
      q(`${continuousHospitalizationCte(filtroSql)}, episode_counts AS (
           SELECT company_key, person_key, count(*) AS internacoes
           FROM episodes
           WHERE admission_month IN (${janela12Sql})
           GROUP BY 1, 2
         )
         SELECT g.person_key,
                max(g.faixa_etaria_usuario) AS faixa, max(g.parentesco_usuario) AS par,
                max(COALESCE(NULLIF(trim(g.nome_lotacao), ''), 'Sem lotação')) AS lot,
                round(sum(g.custo_assistencial_bruto), 2) AS custo,
                count(*) AS itens,
                coalesce(max(e.internacoes), 0) AS internacoes,
                round(100 * sum(g.custo_assistencial_bruto) / sum(sum(g.custo_assistencial_bruto)) OVER (), 2) AS share_pct
         FROM ${GOLD} g
         LEFT JOIN episode_counts e ON g.company_key = e.company_key AND g.person_key = e.person_key
         WHERE NOT g.flag_data_suspeita AND g.month_key IN (${janela12Sql})${filtroSql}
         GROUP BY 1 ORDER BY custo DESC, g.person_key LIMIT 10`),
      // Facets pros multiselects (universo completo dentro do company scope)
      q(`SELECT 'faixa_etaria' AS dim, g.faixa_etaria_usuario AS valor, count(*) AS n
         FROM ${GOLD} g WHERE ${BASE_FILTER} AND g.${JANELA_2024} AND NULLIF(trim(g.faixa_etaria_usuario), '') IS NOT NULL${escopo} GROUP BY 1, 2
         UNION ALL
         SELECT 'sexo', g.genero_usuario, count(*)
         FROM ${GOLD} g WHERE ${BASE_FILTER} AND g.${JANELA_2024} AND NULLIF(trim(g.genero_usuario), '') IS NOT NULL${escopo} GROUP BY 1, 2
         UNION ALL
         SELECT 'tipo_plano', g.tipo_acomodacao, count(*)
         FROM ${GOLD} g WHERE ${BASE_FILTER} AND g.${JANELA_2024} AND NULLIF(trim(g.tipo_acomodacao), '') IS NOT NULL${escopo} GROUP BY 1, 2
         ORDER BY dim, valor`),
      // Cidades/estados do snapshot de elegibilidade, sem literal de empresa.
      q(`SELECT upper(trim(g.state)) AS uf, upper(trim(g.city)) AS cidade, count(*) AS n
         FROM ${SNAPSHOT} g
         WHERE NULLIF(trim(g.city), '') IS NOT NULL${companyScopeSql(auth, "g.company_key")}
         GROUP BY 1, 2 ORDER BY n DESC LIMIT 60`),
      // BI antigo: comparação 4+4 meses. Somente famílias presentes nos dois
      // lados; resultado é associação temporal, não causalidade.
      q(`WITH pre AS (
           SELECT DISTINCT g.family_key AS familia
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita
             AND g.month_key IN (${MADURO_PRE.map((m) => `'${m}'`).join(",")})${filtroSql}
         ), pos AS (
           SELECT DISTINCT g.family_key AS familia
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita
             AND g.month_key IN (${MADURO_POS.map((m) => `'${m}'`).join(",")})${filtroSql}
         ), comuns AS (
           SELECT pre.familia FROM pre INNER JOIN pos USING (familia)
         ), base AS (
           SELECT CASE WHEN g.month_key IN (${MADURO_PRE.map((m) => `'${m}'`).join(",")})
                       THEN 'before' ELSE 'after' END AS periodo,
                  g.family_key AS familia,
                  g.custo_assistencial_bruto AS sinistro, g.tipo_evento
           FROM ${GOLD} g
           INNER JOIN comuns c ON g.family_key = c.familia
           WHERE NOT g.flag_data_suspeita
             AND g.month_key IN (${[...MADURO_PRE, ...MADURO_POS].map((m) => `'${m}'`).join(",")})${filtroSql}
         )
         SELECT periodo, count(DISTINCT familia), count(*), round(sum(sinistro), 2),
                sum(CASE WHEN tipo_evento = 'Pronto Socorro' THEN 1 ELSE 0 END),
                sum(CASE WHEN tipo_evento = 'Internacao' THEN 1 ELSE 0 END),
                sum(CASE WHEN tipo_evento = 'Consulta' THEN 1 ELSE 0 END),
                sum(CASE WHEN tipo_evento = 'Terapia' THEN 1 ELSE 0 END)
         FROM base GROUP BY 1 ORDER BY 1`),
      // Alcance dos canais digitais dentro das famílias utilizantes da janela corrente.
      q(`WITH cohort AS (
           SELECT DISTINCT g.family_key AS familia
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.month_key IN (${janela12Sql})${filtroSql}
         ), contatos AS (
           SELECT CASE
                    WHEN c.source_system = 'healthcoach_gold_live' THEN 'healthcoach'
                    WHEN c.event_type LIKE 'Conexa - PA Digital%' THEN 'ps_digital'
                    ELSE 'consulta_digital'
                  END AS servico,
                  c.family_key AS familia,
                  concat(c.source_system, ':', c.source_event_id, ':', cast(c.event_date AS STRING)) AS evento
           FROM ${COORDENACAO} c
           WHERE (c.source_system = 'healthcoach_gold_live'
                  OR c.event_type LIKE 'Conexa -%Consulta Eletiva%'
                  OR c.event_type LIKE 'Conexa - PA Digital%')
             AND c.event_date BETWEEN to_date('${janelaInicio}-01') AND last_day(to_date('${janelaFim}-01'))
         ), matched AS (
           SELECT c.servico, c.evento, c.familia
           FROM contatos c INNER JOIN cohort h USING (familia)
         ), por_servico AS (
           SELECT servico, count(DISTINCT evento) AS eventos, count(DISTINCT familia) AS familias
           FROM matched GROUP BY 1
           UNION ALL
           SELECT 'qualquer_servico', count(DISTINCT evento), count(DISTINCT familia) FROM matched
         )
         SELECT p.servico, p.eventos, p.familias, (SELECT count(*) FROM cohort) AS familias_cohort
         FROM por_servico p ORDER BY CASE WHEN servico = 'qualquer_servico' THEN 0 ELSE 1 END, servico`),
      // Proximidade não causal: utilização ocorrida até 40 dias depois do contato digital mais próximo.
      q(`WITH eventos AS (
           SELECT g.row_sha256, g.family_key AS familia, g.data_atendimento
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.month_key IN (${janela12Sql})${filtroSql}
         ), contatos AS (
           SELECT DISTINCT c.family_key AS familia, c.event_date AS data_contato
           FROM ${COORDENACAO} c
           WHERE (c.source_system = 'healthcoach_gold_live'
                  OR c.event_type LIKE 'Conexa -%Consulta Eletiva%'
                  OR c.event_type LIKE 'Conexa - PA Digital%')
             AND c.event_date BETWEEN date_sub(to_date('${janelaInicio}-01'), 40) AND last_day(to_date('${janelaFim}-01'))
         ), proximos AS (
           SELECT e.row_sha256, max(e.familia) AS familia,
                  min(datediff(e.data_atendimento, c.data_contato)) AS dias
           FROM eventos e INNER JOIN contatos c
             ON e.familia = c.familia
            AND c.data_contato <= e.data_atendimento
            AND datediff(e.data_atendimento, c.data_contato) BETWEEN 0 AND 40
           GROUP BY e.row_sha256
         )
         SELECT (SELECT count(*) FROM eventos), count(*),
                sum(CASE WHEN dias = 0 THEN 1 ELSE 0 END),
                sum(CASE WHEN dias <= 7 THEN 1 ELSE 0 END),
                sum(CASE WHEN dias <= 15 THEN 1 ELSE 0 END),
                count(*), round(avg(dias), 1), count(DISTINCT familia)
         FROM proximos`),
      // Série por COMPETÊNCIA DE COBRANÇA: "quanto foi faturado no mês",
      // contra o "quanto foi atendido no mês" da série `mensal`. Mesmo
      // recorte de filtros; o eixo é que muda.
      q(`SELECT date_format(to_date(g.competencia_cobranca, 'dd/MM/yyyy'), 'yyyy-MM') AS competencia,
           round(sum(g.custo_assistencial_bruto), 2) AS sinistro,
           sum(g.quantidade_servicos) AS servicos,
           count(*) AS linhas
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita
           AND date_format(to_date(g.competencia_cobranca, 'dd/MM/yyyy'), 'yyyy-MM') >= ${SERIE_INICIO}${filtroSql}
         GROUP BY 1 ORDER BY 1`),
    ]);

    const kpi = kpiRows[0] || [];
    const total24 = total24Rows[0] || [];
    const conc = concRows[0] || [];
    const intStats = intStatsRows[0] || [];
    const versao = versaoRows[0] || [];
    const proximidade = proximidadeRows[0] || [];

    const maduro = Object.fromEntries(maduroRows.map((r) => [String(getCell(r[0])), {
      familias: toInt(r[1]),
      itens: toInt(r[2]),
      sinistro: toNum(r[3]),
      pronto_socorro: toInt(r[4]),
      internacao: toInt(r[5]),
      consulta: toInt(r[6]),
      terapia: toInt(r[7]),
    }]));

    const deltaPct = (before: number, after: number) => before ? +(((after - before) / before) * 100).toFixed(1) : null;

    const impactoMes = impactoMesRows.map((r) => ({
      mes: String(getCell(r[0])),
      itens: toInt(r[1]),
      sinistro: toNum(r[2]),
      utilizantes: toInt(r[3]),
    }));
    const impactoEventos = EVENTOS_COMPARAVEIS.map((tipo_evento) => {
      const before = impactoEventoRows.find((r) => String(getCell(r[0])) === "before" && String(getCell(r[1])) === tipo_evento);
      const after = impactoEventoRows.find((r) => String(getCell(r[0])) === "after" && String(getCell(r[1])) === tipo_evento);
      return { tipo_evento, before_itens: toInt(before?.[2]), after_itens: toInt(after?.[2]) };
    });
    const janelaMedia = (meses: string[]) => {
      const sel = impactoMes.filter((m) => meses.includes(m.mes));
      const n = sel.length || 1;
      return {
        meses,
        itens_media_mensal: Math.round(sel.reduce((s, m) => s + m.itens, 0) / n),
        sinistro_media_mensal: +(sel.reduce((s, m) => s + m.sinistro, 0) / n).toFixed(2),
        utilizantes_media_mensal: Math.round(sel.reduce((s, m) => s + m.utilizantes, 0) / n),
      };
    };

    const facets: Record<string, string[]> = { faixa_etaria: [], sexo: [], tipo_plano: [] };
    for (const r of facetRows) {
      const dim = String(getCell(r[0]));
      if (facets[dim]) facets[dim].push(String(getCell(r[1])));
    }
    const estadosSet = new Set<string>();
    const cidades: string[] = [];
    for (const r of cidadeRows) {
      const uf = String(getCell(r[0]) || "").trim();
      const cid = String(getCell(r[1]) || "").trim();
      if (uf) estadosSet.add(uf);
      if (cid && !cidades.includes(cid)) cidades.push(cid);
    }

    const competencia = competenciaRows
      .map((r) => ({
        mes: String(getCell(r[0])),
        sinistro: toNum(r[1]),
        servicos: toNum(r[2]),
        linhas: toInt(r[3]),
      }))
      .filter((c) => mesValido(c.mes))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    const maduroBefore = maduro.before || { familias: 0, itens: 0, sinistro: 0, pronto_socorro: 0, internacao: 0, consulta: 0, terapia: 0 };
    const maduroAfter = maduro.after || { familias: 0, itens: 0, sinistro: 0, pronto_socorro: 0, internacao: 0, consulta: 0, terapia: 0 };
    const servicosJornada = servicoRows.map((r) => {
      const familiasCohort = toInt(r[3]);
      const familias = toInt(r[2]);
      return {
        servico: String(getCell(r[0])),
        eventos: toInt(r[1]),
        familias,
        familias_cohort: familiasCohort,
        alcance_pct: familiasCohort ? +((100 * familias) / familiasCohort).toFixed(1) : null,
      };
    });

    setStableCache(res);
    res.status(200).json({
      filtros: {
        aplicados,
        disponiveis: {
          ...facets,
          estado: [...estadosSet].sort(),
          cidade: cidades.slice(0, 40),
          servico_sanus: [
            { valor: "consulta_digital", label: "Consulta Digital (Conexa eletiva)" },
            { valor: "ps_digital", label: "PS Digital (Conexa PA)" },
            { valor: "healthcoach", label: "HealthCoach" },
            { valor: "consulta_fisica", label: "Consulta Física (rede)" },
            { valor: "ps_fisico", label: "PS Físico (rede)" },
          ],
        },
        notas: [
          "cidade/estado: snapshot de elegibilidade da família do titular; cobertura parcial da ponte familiar",
          "servico_sanus: filtra famílias (family_key) que usaram o serviço; digitais via coordenação Sanus, físicos via sinistro",
          "linha_cuidado: fonte não existe no Databricks — pendente definição/ingestão",
        ],
      },
      fonte: {
        gold: "gold_sinistro_evento_v2",
        contract_version: SINISTRALIDADE_CONTRACT_VERSION,
        delta_version: toInt(versao[0]),
        delta_timestamp: getCell(versao[1]),
        gerado_em: new Date().toISOString(),
        filtro: "NOT flag_data_suspeita",
        role: auth.role,
      },
      mensal: relevantes.map((m) => {
        const estado = statusPorMes.get(m.mes) === "closed" ? "closed" : statusPorMes.get(m.mes) === "partial" ? "partial" : "unknown";
        return { ...m, parcial: estado !== "closed", estado };
      }),
      competencia,
      composicao_tipo_evento: composicao,
      kpis: {
        periodo: fechados.length ? "closed" : "observed",
        ultimo_mes_fechado: ultimoFechadoMes,
        sinistro_ultimo_mes_fechado: ultimoFechado?.sinistro ?? null,
        utilizantes_ultimo_mes_fechado: toInt(kpi[3]) || (ultimoFechado?.utilizantes ?? null),
        janela_12m: janela12,
        sinistro_12m: toNum(kpi[0]),
        utilizantes_12m: toInt(kpi[1]),
        custo_por_utilizante_12m: toInt(kpi[1]) ? +(toNum(kpi[0]) / toInt(kpi[1])).toFixed(2) : null,
        reembolso_share_12m: toNum(kpi[0]) ? +(100 * toNum(kpi[2]) / toNum(kpi[0])).toFixed(2) : null,
      },
      lotacoes: lotacaoRows.map((r) => ({
        lotacao: String(getCell(r[0])),
        sinistro: toNum(r[1]),
        beneficiarios: toInt(r[2]),
        share: toNum(r[3]) ? +(100 * toNum(r[1]) / toNum(r[3])).toFixed(1) : null,
      })),
      prestadores: {
        total_prestadores: toInt(prestadorRows[0]?.[3]),
        sinistro_total: toNum(prestadorRows[0]?.[2]),
        top: prestadorRows.map((r) => ({
          prestador: String(getCell(r[0]) || "—"),
          sinistro: toNum(r[1]),
          share: toNum(r[2]) ? +(100 * toNum(r[1]) / toNum(r[2])).toFixed(1) : null,
        })),
      },
      concentracao: {
        janela: janela12,
        utilizantes: toInt(conc[0]),
        top1_pessoas: toInt(conc[1]),
        top1_share: toNum(conc[2]),
        top5_share: toNum(conc[3]),
      },
      internacao: {
        por_agrupamento: intAgrupRows.map((r) => ({ agrupamento: String(getCell(r[0])), sinistro_mi: toNum(r[1]) })),
        linhas_assistenciais: toInt(intStats[0]),
        internacoes_distintas: toInt(intStats[1]),
        beneficiarios_unicos: toInt(intStats[2]),
        dias_internados: toInt(intStats[3]),
        custo_medio: toNum(intStats[4]),
        duracao_mediana_dias: toNum(intStats[5]),
        duracao_p90_dias: toNum(intStats[6]),
      },
      saude_mental: {
        share_flag: toNum(total24[0]) ? +(100 * toNum(total24[1]) / toNum(total24[0])).toFixed(2) : null,
        share_sem_classificacao: toNum(total24[0]) ? +(100 * toNum(total24[2]) / toNum(total24[0])).toFixed(2) : null,
        por_tema_mi: smTemaRows.map((r) => ({ tema: String(getCell(r[0])), sinistro_mi: toNum(r[1]) })),
      },
      impacto_sanus: {
        metodologia: "janelas pareadas (mesma da aba Análise Sinistro), eixo data_atendimento, sinistro bruto",
        pre: janelaMedia(IMPACTO_PRE),
        pos: janelaMedia(IMPACTO_POS),
        eventos: impactoEventos,
        trimestres_utilizantes: triRows.map((r) => ({ trimestre: String(getCell(r[0])), utilizantes: toInt(r[2]) })),
      },
      comparacao_madura: {
        metodologia: "4 meses antes vs 4 meses depois; somente famílias presentes nas duas janelas; associação temporal, não causalidade",
        before_meses: MADURO_PRE,
        after_meses: MADURO_POS,
        familias_comuns: Math.min(maduroBefore.familias, maduroAfter.familias),
        before: {
          ...maduroBefore,
          sinistro_medio_mensal: +(maduroBefore.sinistro / MADURO_PRE.length).toFixed(2),
          itens_medio_mensal: Math.round(maduroBefore.itens / MADURO_PRE.length),
          sinistro_por_familia_mes: maduroBefore.familias ? +(maduroBefore.sinistro / maduroBefore.familias / MADURO_PRE.length).toFixed(2) : null,
          itens_por_familia_mes: maduroBefore.familias ? +(maduroBefore.itens / maduroBefore.familias / MADURO_PRE.length).toFixed(2) : null,
        },
        after: {
          ...maduroAfter,
          sinistro_medio_mensal: +(maduroAfter.sinistro / MADURO_POS.length).toFixed(2),
          itens_medio_mensal: Math.round(maduroAfter.itens / MADURO_POS.length),
          sinistro_por_familia_mes: maduroAfter.familias ? +(maduroAfter.sinistro / maduroAfter.familias / MADURO_POS.length).toFixed(2) : null,
          itens_por_familia_mes: maduroAfter.familias ? +(maduroAfter.itens / maduroAfter.familias / MADURO_POS.length).toFixed(2) : null,
        },
        deltas_pct: {
          sinistro_medio_mensal: deltaPct(maduroBefore.sinistro, maduroAfter.sinistro),
          itens_medio_mensal: deltaPct(maduroBefore.itens, maduroAfter.itens),
          sinistro_por_familia_mes: deltaPct(
            maduroBefore.familias ? maduroBefore.sinistro / maduroBefore.familias : 0,
            maduroAfter.familias ? maduroAfter.sinistro / maduroAfter.familias : 0,
          ),
          itens_por_familia_mes: deltaPct(
            maduroBefore.familias ? maduroBefore.itens / maduroBefore.familias : 0,
            maduroAfter.familias ? maduroAfter.itens / maduroAfter.familias : 0,
          ),
          pronto_socorro: deltaPct(maduroBefore.pronto_socorro, maduroAfter.pronto_socorro),
          internacao: deltaPct(maduroBefore.internacao, maduroAfter.internacao),
          consulta: deltaPct(maduroBefore.consulta, maduroAfter.consulta),
          terapia: deltaPct(maduroBefore.terapia, maduroAfter.terapia),
        },
      },
      jornada_sanus: {
        janela: janela12,
        metodologia: "ponte por family_key (empresa + titular) da coordenação Sanus; cobertura parcial para dependentes; associação de proximidade, não atribuição",
        servicos: servicosJornada,
        proximidade: {
          utilizacoes_cohort: toInt(proximidade[0]),
          utilizacoes_ate_40d: toInt(proximidade[1]),
          mesmo_dia: toInt(proximidade[2]),
          ate_7d: toInt(proximidade[3]),
          ate_15d: toInt(proximidade[4]),
          ate_40d: toInt(proximidade[5]),
          media_dias: toNum(proximidade[6]),
          familias_com_proximidade: toInt(proximidade[7]),
        share_ate_40d: toInt(proximidade[0]) ? +((100 * toInt(proximidade[1])) / toInt(proximidade[0])).toFixed(1) : null,
        },
      },
      top_utilizantes: {
        janela: janela12,
        aviso: "dado sensível — uso interno; ranking mascarado por chave opaca (person_key); sem atributos clínicos",
        lista: topUtiRows.map((r) => ({
          codigo_usuario: maskPerson(String(getCell(r[0]))),
          id_corrompido: false,
          faixa_etaria: String(getCell(r[1]) || "—"),
          parentesco: String(getCell(r[2]) || "—"),
          lotacao: String(getCell(r[3]) || "—"),
          custo: toNum(r[4]),
          itens: toInt(r[5]),
          internacoes: toInt(r[6]),
          share: toNum(r[7]),
        })),
      },
      carteira: (() => {
        const totalSin = carteiraRows.reduce((s, r) => s + toNum(r[2]), 0);
        return {
          operadoras: [...new Set(carteiraRows.map((r) => String(getCell(r[0]) || "?")))],
          empresas: carteiraRows.map((r) => ({
            nome: String(getCell(r[1]) || "—"),
            sinistro: toNum(r[2]),
            share: totalSin ? +(100 * toNum(r[2]) / totalSin).toFixed(2) : null,
            beneficiarios: toInt(r[3]),
          })),
          beneficiarios_total: carteiraRows.reduce((s, r) => s + toInt(r[3]), 0),
        };
      })(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
