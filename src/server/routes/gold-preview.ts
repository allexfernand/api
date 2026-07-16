// api/gold-preview.ts — dados reais para a aba PREVIEW-gold (DAT-176/177)
// Fonte: hive_metastore.sanus_prod.gold_sinistro_evento + visões agregadas gold_sinistro_*_mes (DAT-175)
import { rejectMdsAuth, requireBasicAuth } from "../../../lib/basic-auth";
import { escape, getCell, resolveWarehouseId, runQuery, toInt, toNum } from "../../../lib/databricks";
import { setApiCors, setStableCache } from "../../../lib/http";

type ApiRequest = { method?: string; query: Record<string, any>; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

const GOLD = `hive_metastore.sanus_prod.gold_sinistro_evento`;
const VIEW_TIPO_EVENTO = `hive_metastore.sanus_prod.gold_sinistro_tipo_evento_mes`;
const VIEW_PRESTADOR = `hive_metastore.sanus_prod.gold_sinistro_prestador_mes`;
const SILVER_FINAL = `hive_metastore.sanus_prod.utilizacao_silver_final`;

const BASE_FILTER = `NOT flag_data_suspeita`;
const JANELA_2024 = `ano_mes_atendimento >= '2024-01'`;
const SERIE_INICIO = `'2025-01'`;
// Janelas pareadas da metodologia da aba Análise Sinistro (impacto Sanus)
const IMPACTO_PRE = ["2025-08", "2025-09"];
const IMPACTO_POS = ["2025-10", "2025-11"];
// Comparação mais madura herdada do BI Azul: quatro meses completos de cada lado.
// Mantemos apenas famílias presentes nas duas janelas para reduzir efeito de entrada/saída da carteira.
const MADURO_PRE = ["2025-06", "2025-07", "2025-08", "2025-09"];
const MADURO_POS = ["2025-10", "2025-11", "2025-12", "2026-01"];
const SINISTRO_MES_MINIMO = 100_000; // abaixo disso o mês é só lag residual, não entra na série

const mesValido = (m: string) => /^\d{4}-\d{2}$/.test(m);

const ATENDIMENTO = `hive_metastore.sanus_prod.atendimento_gold_live`;
const HEALTHCOACH = `hive_metastore.sanus_prod.healthcoach_gold_live`;
const VW_BENEF = `hive_metastore.sanus_prod.vw_beneficiarios`;
// Normalizador de CPF usado nos joins (formatos divergem entre fontes)
const CPF = (col: string) => `lpad(regexp_replace(${col}, '[^0-9]', ''), 11, '0')`;

const SERVICOS_SANUS: Record<string, string> = {
  // Digitais: uso da plataforma Sanus (Conexa/HealthCoach). Ponte = cpf_atendido ↔ gold.cpf_titular
  // (o cpf_titular do CRM é placeholder pra Azul — só 4 valores distintos; cpf_atendido casa 72,5%).
  // Cobertura: atendimentos digitais DO TITULAR; dependente atendido digitalmente não casa.
  consulta_digital: `SELECT DISTINCT ${CPF("cpf_atendido")} FROM ${ATENDIMENTO} WHERE assunto LIKE 'Conexa -%Consulta Eletiva%' AND cpf_atendido IS NOT NULL`,
  ps_digital: `SELECT DISTINCT ${CPF("cpf_atendido")} FROM ${ATENDIMENTO} WHERE assunto LIKE 'Conexa - PA Digital%' AND cpf_atendido IS NOT NULL`,
  healthcoach: `SELECT DISTINCT ${CPF("cpf_atendido")} FROM ${HEALTHCOACH} WHERE cpf_atendido IS NOT NULL`,
  // Físicos: uso na rede, direto da gold de sinistro
  consulta_fisica: `SELECT DISTINCT ${CPF("cpf_titular")} FROM hive_metastore.sanus_prod.gold_sinistro_evento WHERE tipo_evento = 'Consulta'`,
  ps_fisico: `SELECT DISTINCT ${CPF("cpf_titular")} FROM hive_metastore.sanus_prod.gold_sinistro_evento WHERE flag_pronto_socorro`,
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

  // Cidade/estado vêm do cadastro (vw_beneficiarios) do TITULAR — vale para o grupo familiar
  const cidade = parseMulti(query, "cidade");
  const estado = parseMulti(query, "estado");
  if (cidade.length || estado.length) {
    if (cidade.length) aplicados.cidade = cidade;
    if (estado.length) aplicados.estado = estado;
    const conds = [
      "upper(trim(coalesce(TIPO_BENEFICIARIO, ''))) LIKE 'TITULAR%'",
      cidade.length ? inClause("upper(trim(CIDADE))", cidade.map((c) => c.toUpperCase())) : "",
      estado.length ? inClause("upper(trim(UF))", estado.map((e) => e.toUpperCase())) : "",
    ].filter(Boolean).join(" AND ");
    clauses.push(`${CPF("g.cpf_titular")} IN (SELECT DISTINCT ${CPF("CPF_BENEFICIARIO")} FROM ${VW_BENEF} WHERE ${conds})`);
  }

  const servicos = parseMulti(query, "servico_sanus").filter((s) => SERVICOS_SANUS[s]);
  if (servicos.length) {
    aplicados.servico_sanus = servicos;
    // Grupo familiar tocado por QUALQUER um dos serviços selecionados (união)
    clauses.push(`${CPF("g.cpf_titular")} IN (${servicos.map((s) => SERVICOS_SANUS[s]).join(" UNION ")})`);
  }

  return { aplicados, filtroSql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "" };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (rejectMdsAuth(req, res)) return;

  try {
    const warehouseId = await resolveWarehouseId();
    const q = (sql: string) => runQuery(warehouseId, sql);

    const { aplicados, filtroSql } = buildFiltroSql(req.query);
    const filtroAtivo = filtroSql !== "";

    // ---- Fase 1: séries mensais + versão da fonte (definem mês fechado e janela 12m)
    // Com filtro ativo, as visões agregadas não servem (não têm as colunas de filtro) → gold direto.
    const [mensalTipoRows, mensalGoldRows, versaoRows] = await Promise.all([
      q(filtroAtivo
        ? `SELECT g.ano_mes_atendimento, COALESCE(NULLIF(trim(g.tipo_evento), ''), 'Sem classificação'), round(sum(g.sinistro), 2)
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento >= ${SERIE_INICIO}${filtroSql}
           GROUP BY 1, 2 ORDER BY 1`
        : `SELECT ano_mes_atendimento, tipo_evento, round(sum(sinistro_total), 2)
           FROM ${VIEW_TIPO_EVENTO}
           WHERE ano_mes_atendimento >= ${SERIE_INICIO}
           GROUP BY 1, 2 ORDER BY 1`),
      q(`SELECT g.ano_mes_atendimento, count(DISTINCT g.codigo_usuario), count(*), round(sum(g.sinistro), 2)
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento >= ${SERIE_INICIO}${filtroSql}
         GROUP BY 1 ORDER BY 1`),
      q(`SELECT version, timestamp FROM (DESCRIBE HISTORY ${SILVER_FINAL}) ORDER BY version DESC LIMIT 1`),
    ]);

    const mensal = mensalGoldRows.map((r) => ({
      mes: String(getCell(r[0])),
      utilizantes: toInt(r[1]),
      itens: toInt(r[2]),
      sinistro: toNum(r[3]),
    })).filter((m) => mesValido(m.mes)).sort((a, b) => a.mes.localeCompare(b.mes));

    const relevantes = mensal.filter((m) => m.sinistro >= SINISTRO_MES_MINIMO);
    const nParciais = Math.min(2, Math.max(relevantes.length - 1, 0));
    const fechados = relevantes.slice(0, relevantes.length - nParciais);
    const parciais = relevantes.slice(relevantes.length - nParciais).map((m) => m.mes);
    const ultimoFechado = fechados[fechados.length - 1] || null;
    const ultimoFechadoMes = ultimoFechado ? ultimoFechado.mes : null;
    const janela12 = fechados.slice(-12).map((m) => m.mes).filter(mesValido);
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
    const [kpiRows, total24Rows, lotacaoRows, prestadorRows, concRows, intAgrupRows, intStatsRows, smTemaRows, impactoMesRows, triRows, carteiraRows, topUtiRows, facetRows, cidadeRows, maduroRows, servicoRows, proximidadeRows] = await Promise.all([
      q(`WITH mapa AS (
           SELECT cpf_titular, data_nascimento, genero_usuario, parentesco_usuario,
                  min(codigo_usuario) AS codigo_bom
           FROM ${GOLD} WHERE codigo_usuario RLIKE '^[0-9]+$'
           GROUP BY 1, 2, 3, 4 HAVING count(DISTINCT codigo_usuario) = 1
         ), b AS (
           SELECT CASE WHEN g.codigo_usuario NOT RLIKE '^[0-9]+$' AND m.codigo_bom IS NOT NULL
                       THEN m.codigo_bom ELSE g.codigo_usuario END AS usuario,
                  g.sinistro, g.flag_reembolso, g.ano_mes_atendimento AS mes
           FROM ${GOLD} g
           LEFT JOIN mapa m
             ON g.cpf_titular = m.cpf_titular AND g.data_nascimento = m.data_nascimento
            AND g.genero_usuario = m.genero_usuario AND g.parentesco_usuario = m.parentesco_usuario
           WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento IN (${janela12Sql})${filtroSql}
         )
         SELECT round(sum(sinistro), 2), count(DISTINCT usuario),
                round(sum(CASE WHEN flag_reembolso THEN sinistro END), 2),
                count(DISTINCT CASE WHEN mes = '${ultimoFechadoMes ?? ""}' THEN usuario END)
         FROM b`),
      q(`SELECT round(sum(g.sinistro), 2),
                round(sum(CASE WHEN g.flag_saude_mental THEN g.sinistro END), 2),
                round(sum(CASE WHEN g.flag_saude_mental IS NULL THEN g.sinistro END), 2)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.${JANELA_2024}${filtroSql}`),
      q(`SELECT lot, sin, benef, tot FROM (
           SELECT COALESCE(NULLIF(trim(g.nome_lotacao), ''), 'Sem lotação') AS lot,
                  round(sum(g.sinistro), 2) AS sin,
                  count(DISTINCT g.codigo_usuario) AS benef,
                  round(sum(sum(g.sinistro)) OVER (), 2) AS tot,
                  row_number() OVER (ORDER BY sum(g.sinistro) DESC) AS rn
           FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.${JANELA_2024}${filtroSql}
           GROUP BY 1
         ) WHERE rn <= 12 ORDER BY sin DESC`),
      q(filtroAtivo
        ? `SELECT p, sin, tot, nprest FROM (
             SELECT g.prestador AS p,
                    round(sum(g.sinistro), 2) AS sin,
                    round(sum(sum(g.sinistro)) OVER (), 2) AS tot,
                    count(*) OVER () AS nprest,
                    row_number() OVER (ORDER BY sum(g.sinistro) DESC) AS rn
             FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.${JANELA_2024}${filtroSql}
             GROUP BY 1
           ) WHERE rn <= 10 ORDER BY sin DESC`
        : `SELECT p, sin, tot, nprest FROM (
             SELECT prestador AS p,
                    round(sum(sinistro_total), 2) AS sin,
                    round(sum(sum(sinistro_total)) OVER (), 2) AS tot,
                    count(*) OVER () AS nprest,
                    row_number() OVER (ORDER BY sum(sinistro_total) DESC) AS rn
             FROM ${VIEW_PRESTADOR} WHERE ano_mes_atendimento >= '2024-01'
             GROUP BY 1
           ) WHERE rn <= 10 ORDER BY sin DESC`),
      // IDs do lote 316_Utilização_042026.txt vieram em notação científica (milhares de
      // beneficiários colapsados em 2 pseudo-IDs). Reconstrução por chave composta com
      // match único no histórico (~98%) — remove a inflação artificial da concentração.
      q(`WITH mapa AS (
           SELECT cpf_titular, data_nascimento, genero_usuario, parentesco_usuario,
                  min(codigo_usuario) AS codigo_bom
           FROM ${GOLD} WHERE codigo_usuario RLIKE '^[0-9]+$'
           GROUP BY 1, 2, 3, 4 HAVING count(DISTINCT codigo_usuario) = 1
         ), u AS (
           SELECT CASE WHEN g.codigo_usuario NOT RLIKE '^[0-9]+$' AND m.codigo_bom IS NOT NULL
                       THEN m.codigo_bom ELSE g.codigo_usuario END AS usuario,
                  sum(g.sinistro) AS c
           FROM ${GOLD} g
           LEFT JOIN mapa m
             ON g.cpf_titular = m.cpf_titular AND g.data_nascimento = m.data_nascimento
            AND g.genero_usuario = m.genero_usuario AND g.parentesco_usuario = m.parentesco_usuario
           WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento IN (${janela12Sql})${filtroSql}
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
      q(`SELECT COALESCE(NULLIF(trim(g.agrupamento_internacao), ''), 'Outros') AS agr,
                round(sum(g.sinistro) / 1e6, 2)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.flag_internacao AND g.${JANELA_2024}${filtroSql}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      q(`WITH i AS (
           SELECT g.numero_conta_medica, sum(g.sinistro) AS c, max(g.duracao_internacao_dias) AS d
           FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.flag_internacao AND g.${JANELA_2024}${filtroSql}
           GROUP BY 1
         )
         SELECT count(*), round(sum(c) / count(*), 0), percentile(d, 0.5), percentile(d, 0.9) FROM i`),
      q(`SELECT COALESCE(NULLIF(trim(g.tema_saude_mental), ''), 'Sem tema') AS tema,
                round(sum(g.sinistro) / 1e6, 2)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.flag_saude_mental AND g.${JANELA_2024}${filtroSql}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
      q(`SELECT g.ano_mes_atendimento, count(*), round(sum(g.sinistro), 2), count(DISTINCT g.codigo_usuario)
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento IN (${[...IMPACTO_PRE, ...IMPACTO_POS].map((m) => `'${m}'`).join(",")})${filtroSql}
         GROUP BY 1`),
      q(`SELECT concat('T', quarter(to_date(concat(g.ano_mes_atendimento, '-01'))), '/', substr(g.ano_mes_atendimento, 3, 2)) AS tri,
                min(g.ano_mes_atendimento) AS m0,
                count(DISTINCT g.codigo_usuario)
         FROM ${GOLD} g WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento >= '2025-07'${filtroSql}
         GROUP BY 1 ORDER BY m0`),
      q(`SELECT operadora, nome_empresa_padronizado,
                round(sum(sinistro), 2) AS sin,
                count(DISTINCT codigo_usuario) AS benef
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ${JANELA_2024}
         GROUP BY 1, 2 ORDER BY sin DESC`),
      // Dado sensível (LGPD): beneficiários individuais. Exposição autorizada por Marco (lead)
      // em 2026-07-14; sem atributos clínicos individuais; endpoint já recusa credencial MDS.
      q(`WITH mapa AS (
           SELECT cpf_titular, data_nascimento, genero_usuario, parentesco_usuario,
                  min(codigo_usuario) AS codigo_bom
           FROM ${GOLD} WHERE codigo_usuario RLIKE '^[0-9]+$'
           GROUP BY 1, 2, 3, 4 HAVING count(DISTINCT codigo_usuario) = 1
         )
         SELECT usuario,
                usuario NOT RLIKE '^[0-9]+$' AS id_corrompido,
                max(faixa) AS faixa, max(par) AS par, max(lot) AS lot,
                round(sum(sin), 2) AS custo,
                sum(itens) AS itens,
                sum(internacoes) AS internacoes,
                round(100 * sum(sin) / sum(sum(sin)) OVER (), 2) AS share_pct
         FROM (
           SELECT CASE WHEN g.codigo_usuario NOT RLIKE '^[0-9]+$' AND m.codigo_bom IS NOT NULL
                       THEN m.codigo_bom ELSE g.codigo_usuario END AS usuario,
                  g.faixa_etaria_usuario AS faixa, g.parentesco_usuario AS par,
                  COALESCE(NULLIF(trim(g.nome_lotacao), ''), 'Sem lotação') AS lot,
                  sum(g.sinistro) AS sin, count(*) AS itens,
                  count(DISTINCT CASE WHEN g.flag_internacao THEN g.numero_conta_medica END) AS internacoes
           FROM ${GOLD} g
           LEFT JOIN mapa m
             ON g.cpf_titular = m.cpf_titular AND g.data_nascimento = m.data_nascimento
            AND g.genero_usuario = m.genero_usuario AND g.parentesco_usuario = m.parentesco_usuario
           WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento IN (${janela12Sql})${filtroSql}
           GROUP BY 1, 2, 3, 4
         )
         GROUP BY 1, 2 ORDER BY custo DESC LIMIT 10`),
      // Facets pros multiselects (sempre sem filtro — mostram o universo completo)
      q(`SELECT 'faixa_etaria' AS dim, faixa_etaria_usuario AS valor, count(*) AS n
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ${JANELA_2024} AND NULLIF(trim(faixa_etaria_usuario), '') IS NOT NULL GROUP BY 1, 2
         UNION ALL
         SELECT 'sexo', genero_usuario, count(*)
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ${JANELA_2024} AND NULLIF(trim(genero_usuario), '') IS NOT NULL GROUP BY 1, 2
         UNION ALL
         SELECT 'tipo_plano', tipo_acomodacao, count(*)
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ${JANELA_2024} AND NULLIF(trim(tipo_acomodacao), '') IS NOT NULL GROUP BY 1, 2
         ORDER BY dim, valor`),
      q(`SELECT upper(trim(UF)) AS uf, upper(trim(CIDADE)) AS cidade, count(*) AS n
         FROM ${VW_BENEF}
         WHERE upper(NOME_CLIENTE) LIKE '%AZUL%' AND NULLIF(trim(CIDADE), '') IS NOT NULL
         GROUP BY 1, 2 ORDER BY n DESC LIMIT 60`),
      // BI antigo: comparação 4+4 meses. A versão nova usa somente famílias presentes
      // nos dois lados e deixa explícito que o resultado é associação temporal.
      q(`WITH pre AS (
           SELECT DISTINCT ${CPF("g.cpf_titular")} AS familia
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita
             AND g.ano_mes_atendimento IN (${MADURO_PRE.map((m) => `'${m}'`).join(",")})${filtroSql}
         ), pos AS (
           SELECT DISTINCT ${CPF("g.cpf_titular")} AS familia
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita
             AND g.ano_mes_atendimento IN (${MADURO_POS.map((m) => `'${m}'`).join(",")})${filtroSql}
         ), comuns AS (
           SELECT pre.familia FROM pre INNER JOIN pos USING (familia)
         ), base AS (
           SELECT CASE WHEN g.ano_mes_atendimento IN (${MADURO_PRE.map((m) => `'${m}'`).join(",")})
                       THEN 'before' ELSE 'after' END AS periodo,
                  ${CPF("g.cpf_titular")} AS familia,
                  g.sinistro, g.tipo_evento
           FROM ${GOLD} g
           INNER JOIN comuns c ON ${CPF("g.cpf_titular")} = c.familia
           WHERE NOT g.flag_data_suspeita
             AND g.ano_mes_atendimento IN (${[...MADURO_PRE, ...MADURO_POS].map((m) => `'${m}'`).join(",")})${filtroSql}
         )
         SELECT periodo, count(DISTINCT familia), count(*), round(sum(sinistro), 2),
                sum(CASE WHEN tipo_evento = 'Pronto Socorro' THEN 1 ELSE 0 END),
                sum(CASE WHEN tipo_evento = 'Internacao' THEN 1 ELSE 0 END),
                sum(CASE WHEN tipo_evento = 'Consulta' THEN 1 ELSE 0 END),
                sum(CASE WHEN tipo_evento = 'Terapia' THEN 1 ELSE 0 END)
         FROM base GROUP BY 1 ORDER BY 1`),
      // Alcance dos canais digitais dentro das famílias utilizantes da janela corrente.
      q(`WITH cohort AS (
           SELECT DISTINCT ${CPF("g.cpf_titular")} AS familia
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento IN (${janela12Sql})${filtroSql}
         ), contatos AS (
           SELECT CASE
                    WHEN assunto LIKE 'Conexa - PA Digital%' THEN 'ps_digital'
                    ELSE 'consulta_digital'
                  END AS servico,
                  ${CPF("cpf_atendido")} AS familia,
                  concat('atendimento:', cast(identificacao_atendimento AS STRING), ':', cast(hora_criacao_atendimento AS STRING)) AS evento
           FROM ${ATENDIMENTO}
           WHERE cpf_atendido IS NOT NULL AND hora_criacao_atendimento IS NOT NULL
             AND (assunto LIKE 'Conexa -%Consulta Eletiva%' OR assunto LIKE 'Conexa - PA Digital%')
             AND to_date(hora_criacao_atendimento) BETWEEN to_date('${janelaInicio}-01') AND last_day(to_date('${janelaFim}-01'))
           UNION ALL
           SELECT 'healthcoach', ${CPF("cpf_atendido")},
                  concat('healthcoach:', cast(identificacao_atendimento AS STRING), ':', cast(hora_criacao_atendimento AS STRING))
           FROM ${HEALTHCOACH}
           WHERE cpf_atendido IS NOT NULL AND hora_criacao_atendimento IS NOT NULL
             AND to_date(hora_criacao_atendimento) BETWEEN to_date('${janelaInicio}-01') AND last_day(to_date('${janelaFim}-01'))
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
           SELECT g.row_sha256, ${CPF("g.cpf_titular")} AS familia, g.data_atendimento
           FROM ${GOLD} g
           WHERE NOT g.flag_data_suspeita AND g.ano_mes_atendimento IN (${janela12Sql})${filtroSql}
         ), contatos AS (
           SELECT DISTINCT ${CPF("cpf_atendido")} AS familia, to_date(hora_criacao_atendimento) AS data_contato
           FROM ${ATENDIMENTO}
           WHERE cpf_atendido IS NOT NULL AND hora_criacao_atendimento IS NOT NULL
             AND (assunto LIKE 'Conexa -%Consulta Eletiva%' OR assunto LIKE 'Conexa - PA Digital%')
             AND to_date(hora_criacao_atendimento) BETWEEN date_sub(to_date('${janelaInicio}-01'), 40) AND last_day(to_date('${janelaFim}-01'))
           UNION
           SELECT DISTINCT ${CPF("cpf_atendido")}, to_date(hora_criacao_atendimento)
           FROM ${HEALTHCOACH}
           WHERE cpf_atendido IS NOT NULL AND hora_criacao_atendimento IS NOT NULL
             AND to_date(hora_criacao_atendimento) BETWEEN date_sub(to_date('${janelaInicio}-01'), 40) AND last_day(to_date('${janelaFim}-01'))
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
          "cidade/estado: cadastro do TITULAR (vale para o grupo familiar); cobertura parcial do match por CPF",
          "servico_sanus: filtra famílias (cpf_titular) que usaram o serviço; digitais via plataforma Sanus, físicos via sinistro",
          "linha_cuidado: fonte não existe no Databricks — pendente definição/ingestão",
        ],
      },
      fonte: {
        gold: "gold_sinistro_evento",
        delta_version: toInt(versao[0]),
        delta_timestamp: getCell(versao[1]),
        gerado_em: new Date().toISOString(),
        filtro: "NOT flag_data_suspeita",
      },
      mensal: relevantes.map((m) => ({ ...m, parcial: parciais.includes(m.mes) })),
      composicao_tipo_evento: composicao,
      kpis: {
        ultimo_mes_fechado: ultimoFechadoMes,
        sinistro_ultimo_mes_fechado: ultimoFechado?.sinistro ?? null,
        // IDs reconstruídos: sem a correção, o mês fechado subconta ~9% (lote 042026)
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
        internacoes_distintas: toInt(intStats[0]),
        custo_medio: toNum(intStats[1]),
        duracao_mediana_dias: toNum(intStats[2]),
        duracao_p90_dias: toNum(intStats[3]),
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
        metodologia: "match agregado cpf_atendido ↔ cpf_titular; cobertura parcial para dependentes; associação de proximidade, não atribuição",
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
        aviso: "dado sensível — uso interno; exposição autorizada (Marco, 2026-07-14); sem atributos clínicos",
        lista: topUtiRows.map((r) => ({
          codigo_usuario: String(getCell(r[0])),
          id_corrompido: String(getCell(r[1])) === "true",
          faixa_etaria: String(getCell(r[2]) || "—"),
          parentesco: String(getCell(r[3]) || "—"),
          lotacao: String(getCell(r[4]) || "—"),
          custo: toNum(r[5]),
          itens: toInt(r[6]),
          internacoes: toInt(r[7]),
          share: toNum(r[8]),
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
