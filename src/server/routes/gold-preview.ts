// api/gold-preview.ts — dados reais para a aba PREVIEW-gold (DAT-176/177)
// Fonte: hive_metastore.sanus_prod.gold_sinistro_evento + visões agregadas gold_sinistro_*_mes (DAT-175)
import { rejectMdsAuth, requireBasicAuth } from "../../../lib/basic-auth";
import { getCell, resolveWarehouseId, runQuery, toInt, toNum } from "../../../lib/databricks";
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
const SINISTRO_MES_MINIMO = 100_000; // abaixo disso o mês é só lag residual, não entra na série

const mesValido = (m: string) => /^\d{4}-\d{2}$/.test(m);

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (rejectMdsAuth(req, res)) return;

  try {
    const warehouseId = await resolveWarehouseId();
    const q = (sql: string) => runQuery(warehouseId, sql);

    // ---- Fase 1: séries mensais + versão da fonte (definem mês fechado e janela 12m)
    const [mensalTipoRows, mensalGoldRows, versaoRows] = await Promise.all([
      q(`SELECT ano_mes_atendimento, tipo_evento, round(sum(sinistro_total), 2)
         FROM ${VIEW_TIPO_EVENTO}
         WHERE ano_mes_atendimento >= ${SERIE_INICIO}
         GROUP BY 1, 2 ORDER BY 1`),
      q(`SELECT ano_mes_atendimento, count(DISTINCT codigo_usuario), count(*), round(sum(sinistro), 2)
         FROM ${GOLD}
         WHERE ${BASE_FILTER} AND ano_mes_atendimento >= ${SERIE_INICIO}
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

    const composicao: Record<string, Record<string, number>> = {};
    for (const r of mensalTipoRows) {
      const mes = String(getCell(r[0]));
      if (!mesValido(mes)) continue;
      const tipo = String(getCell(r[1]) || "Sem classificação").trim() || "Sem classificação";
      (composicao[mes] ||= {})[tipo] = (composicao[mes]?.[tipo] || 0) + toNum(r[2]);
    }

    // ---- Fase 2: KPIs, blocos e impacto (dependem da janela 12m)
    const [kpiRows, total24Rows, lotacaoRows, prestadorRows, concRows, intAgrupRows, intStatsRows, smTemaRows, impactoMesRows, triRows, carteiraRows] = await Promise.all([
      q(`SELECT round(sum(sinistro), 2), count(DISTINCT codigo_usuario),
                round(sum(CASE WHEN flag_reembolso THEN sinistro END), 2)
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ano_mes_atendimento IN (${janela12Sql})`),
      q(`SELECT round(sum(sinistro), 2),
                round(sum(CASE WHEN flag_saude_mental THEN sinistro END), 2),
                round(sum(CASE WHEN flag_saude_mental IS NULL THEN sinistro END), 2)
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ${JANELA_2024}`),
      q(`SELECT lot, sin, benef, tot FROM (
           SELECT COALESCE(NULLIF(trim(nome_lotacao), ''), 'Sem lotação') AS lot,
                  round(sum(sinistro), 2) AS sin,
                  count(DISTINCT codigo_usuario) AS benef,
                  round(sum(sum(sinistro)) OVER (), 2) AS tot,
                  row_number() OVER (ORDER BY sum(sinistro) DESC) AS rn
           FROM ${GOLD} WHERE ${BASE_FILTER} AND ${JANELA_2024}
           GROUP BY 1
         ) WHERE rn <= 12 ORDER BY sin DESC`),
      q(`SELECT p, sin, tot, nprest FROM (
           SELECT prestador AS p,
                  round(sum(sinistro_total), 2) AS sin,
                  round(sum(sum(sinistro_total)) OVER (), 2) AS tot,
                  count(*) OVER () AS nprest,
                  row_number() OVER (ORDER BY sum(sinistro_total) DESC) AS rn
           FROM ${VIEW_PRESTADOR} WHERE ano_mes_atendimento >= '2024-01'
           GROUP BY 1
         ) WHERE rn <= 10 ORDER BY sin DESC`),
      q(`WITH u AS (
           SELECT codigo_usuario, sum(sinistro) AS c
           FROM ${GOLD} WHERE ${BASE_FILTER} AND ano_mes_atendimento IN (${janela12Sql})
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
      q(`SELECT COALESCE(NULLIF(trim(agrupamento_internacao), ''), 'Outros') AS g,
                round(sum(sinistro) / 1e6, 2)
         FROM ${GOLD} WHERE ${BASE_FILTER} AND flag_internacao AND ${JANELA_2024}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      q(`WITH i AS (
           SELECT numero_conta_medica, sum(sinistro) AS c, max(duracao_internacao_dias) AS d
           FROM ${GOLD} WHERE ${BASE_FILTER} AND flag_internacao AND ${JANELA_2024}
           GROUP BY 1
         )
         SELECT count(*), round(sum(c) / count(*), 0), percentile(d, 0.5), percentile(d, 0.9) FROM i`),
      q(`SELECT COALESCE(NULLIF(trim(tema_saude_mental), ''), 'Sem tema') AS tema,
                round(sum(sinistro) / 1e6, 2)
         FROM ${GOLD} WHERE ${BASE_FILTER} AND flag_saude_mental AND ${JANELA_2024}
         GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
      q(`SELECT ano_mes_atendimento, count(*), round(sum(sinistro), 2), count(DISTINCT codigo_usuario)
         FROM ${GOLD}
         WHERE ${BASE_FILTER} AND ano_mes_atendimento IN (${[...IMPACTO_PRE, ...IMPACTO_POS].map((m) => `'${m}'`).join(",")})
         GROUP BY 1`),
      q(`SELECT concat('T', quarter(to_date(concat(ano_mes_atendimento, '-01'))), '/', substr(ano_mes_atendimento, 3, 2)) AS tri,
                min(ano_mes_atendimento) AS m0,
                count(DISTINCT codigo_usuario)
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ano_mes_atendimento >= '2025-07'
         GROUP BY 1 ORDER BY m0`),
      q(`SELECT operadora, nome_empresa_padronizado,
                round(sum(sinistro), 2) AS sin,
                count(DISTINCT codigo_usuario) AS benef
         FROM ${GOLD} WHERE ${BASE_FILTER} AND ${JANELA_2024}
         GROUP BY 1, 2 ORDER BY sin DESC`),
    ]);

    const kpi = kpiRows[0] || [];
    const total24 = total24Rows[0] || [];
    const conc = concRows[0] || [];
    const intStats = intStatsRows[0] || [];
    const versao = versaoRows[0] || [];

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

    setStableCache(res);
    res.status(200).json({
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
        utilizantes_ultimo_mes_fechado: ultimoFechado?.utilizantes ?? null,
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
