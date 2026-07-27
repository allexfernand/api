"use client";

// B6 (Impacto Sanus, janelas pareadas) e B7 (Comparação madura 4+4 meses) do
// fragmento legado (src/dashboard/fragments/gold-preview.html linhas
// 129-194) e public/scripts/gold-preview.js (deltaBadge, deltaText,
// renderComparacaoMadura).
//
// `impacto_sanus` e `comparacao_madura` chegam como z.object({}).passthrough()
// no contrato (src/contracts/gold-preview.ts) — o shape real só existe no
// handler (src/server/routes/gold-preview.ts, chaves `impacto_sanus` e
// `comparacao_madura`). Os tipos e o parser abaixo espelham exatamente o que
// o handler devolve, com o mesmo padrão defensivo de
// FacetPanel.opcoesDoCampo: cast para Record<string, unknown> + validação por
// campo, nunca `any`.
//
// Os dois blocos são leitura de ASSOCIAÇÃO TEMPORAL, não de causalidade: o
// texto de metodologia que vem pronto do servidor em cada bloco
// (impacto_sanus.metodologia / comparacao_madura.metodologia) diz isso
// explicitamente e é reproduzido na tela sem paráfrase, não substituído por
// um aviso genérico escrito aqui. Delta nulo sempre vira travessão — nunca
// zero (deltaLabel abaixo).
//
// Duas anotações do fragmento legado nos tiles "Eventos"/"Sinistro" de B6
// (gold-preview.html linhas 141 e 151) não foram portadas de propósito:
// "confere com a aba Análise Sinistro ✓" e o aviso de que a aba antiga
// mostrava +15,3% (pendência de alinhar eixo/definição de custo). As duas
// só faziam sentido enquanto esta tela era um preview separado da aba
// Análise Sinistro antiga — a mesma razão documentada em Methodology.tsx
// para a frase de pendência que também não foi portada.

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { monthTick } from "../../sinistralidade/components/charts";
import { LineageAnchor } from "../../sinistralidade/components/LineageAnchor";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const moedaCompacta = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 2 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatadorDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// impacto_sanus (B6) — narrado a partir do handler, ver comentário acima.

type JanelaMedia = { meses: string[]; itens_media_mensal: number; sinistro_media_mensal: number; utilizantes_media_mensal: number };
type TrimestreUtilizantes = { trimestre: string; utilizantes: number | null };
type ImpactoSanus = {
  metodologia: string;
  pre: JanelaMedia | null;
  pos: JanelaMedia | null;
  trimestres_utilizantes: TrimestreUtilizantes[];
};

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Rótulo do intervalo de meses (ex.: "ago/25–set/25") a partir do array real
// de meses do payload — nunca escrito à mão: as janelas pré/pós e antes/depois
// são constantes fixas no servidor (IMPACTO_PRE/POS, MADURO_PRE/POS) e podem
// mudar sem aviso; o texto precisa acompanhar o dado, não descrevê-lo de cor.
function intervaloMeses(meses: string[]): string {
  if (!meses.length) return "—";
  const inicio = monthTick(meses[0]);
  const fim = monthTick(meses[meses.length - 1]);
  return inicio === fim ? inicio : `${inicio}–${fim}`;
}

// Um trimestre só é "completo" se o seu último mês calendário já é <= o
// último mês FECHADO da série mensal (kpis.ultimo_mes_fechado) — o mesmo
// sinal de fechamento que o resto da aba usa, não a posição do item no
// array. trimestre chega como "T{1-4}/{aa}" (ver gold-preview.ts); sem essa
// referência (ultimoMesFechado nulo) não há como afirmar que um trimestre
// fechou, então nenhum é tratado como completo.
const ULTIMO_MES_DO_TRIMESTRE: Record<string, string> = { "1": "03", "2": "06", "3": "09", "4": "12" };

function trimestreCompleto(trimestre: string, ultimoMesFechado: string | null): boolean {
  if (!ultimoMesFechado) return false;
  const match = /^T([1-4])\/(\d{2})$/.exec(trimestre);
  if (!match) return false;
  const [, numero, aa] = match;
  const ultimoMes = `20${aa}-${ULTIMO_MES_DO_TRIMESTRE[numero]}`;
  return ultimoMes <= ultimoMesFechado;
}

function janelaMediaOrNull(value: unknown): JanelaMedia | null {
  if (!value || typeof value !== "object") return null;
  const bruto = value as Record<string, unknown>;
  const itens = numOrNull(bruto.itens_media_mensal);
  const sinistro = numOrNull(bruto.sinistro_media_mensal);
  const utilizantes = numOrNull(bruto.utilizantes_media_mensal);
  if (itens === null || sinistro === null || utilizantes === null) return null;
  return { meses: strArray(bruto.meses), itens_media_mensal: itens, sinistro_media_mensal: sinistro, utilizantes_media_mensal: utilizantes };
}

function parseImpactoSanus(raw: GoldPreview["impacto_sanus"]): ImpactoSanus {
  const bruto = raw as Record<string, unknown>;
  const trimestresBruto = Array.isArray(bruto.trimestres_utilizantes) ? bruto.trimestres_utilizantes : [];
  return {
    metodologia: strOrEmpty(bruto.metodologia),
    pre: janelaMediaOrNull(bruto.pre),
    pos: janelaMediaOrNull(bruto.pos),
    trimestres_utilizantes: trimestresBruto
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({ trimestre: strOrEmpty(item.trimestre), utilizantes: numOrNull(item.utilizantes) })),
  };
}

// pre/pos de impacto_sanus não trazem delta pronto (diferente de
// comparacao_madura.deltas_pct) — o servidor só devolve as duas médias; o
// fragmento legado também calculava o delta no cliente (deltaBadge). pre
// nulo ou zero não permite calcular variação percentual.
function deltaClientSide(pre: number | null, pos: number | null): number | null {
  if (pre === null || pos === null || pre === 0) return null;
  return ((pos - pre) / pre) * 100;
}

function deltaLabel(value: number | null): { texto: string; classe: string } {
  if (value === null) return { texto: "—", classe: "" };
  const caiu = value <= 0;
  return {
    texto: `${caiu ? "▼" : "▲"} ${formatadorPercentual.format(Math.abs(value))}%`,
    classe: caiu ? styles.deltaDown : styles.deltaUp,
  };
}

function DeltaChip({ value }: { value: number | null }) {
  const { texto, classe } = deltaLabel(value);
  return <span className={`${styles.deltaChip} ${classe}`}>{texto}</span>;
}

function SanusImpactBlock({
  impacto,
  ultimoMesFechado,
}: {
  impacto: GoldPreview["impacto_sanus"];
  ultimoMesFechado: string | null;
}) {
  const dados = parseImpactoSanus(impacto);
  const deltaItens = deltaClientSide(dados.pre?.itens_media_mensal ?? null, dados.pos?.itens_media_mensal ?? null);
  const deltaSinistro = deltaClientSide(dados.pre?.sinistro_media_mensal ?? null, dados.pos?.sinistro_media_mensal ?? null);
  const deltaUtilizantes = deltaClientSide(dados.pre?.utilizantes_media_mensal ?? null, dados.pos?.utilizantes_media_mensal ?? null);

  return (
    <LineageAnchor lineageId="claims.sanus-impact" label="Impacto Sanus — janelas pareadas">
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Impacto Sanus — janelas pareadas</h3>
          <p>
            Janelas fixas de comparação: {intervaloMeses(dados.pre?.meses ?? [])} × {intervaloMeses(dados.pos?.meses ?? [])} · eixo: data do atendimento.
          </p>
        </div>
        <div className={styles.statGrid}>
          <StatFlow label="Eventos · média mensal" pre={dados.pre?.itens_media_mensal ?? null} pos={dados.pos?.itens_media_mensal ?? null} delta={deltaItens} formatar={(v) => formatadorInteiro.format(v)} />
          <StatFlow label="Sinistro · média mensal" pre={dados.pre?.sinistro_media_mensal ?? null} pos={dados.pos?.sinistro_media_mensal ?? null} delta={deltaSinistro} formatar={(v) => moedaCompacta.format(v)} />
          <StatFlow label="Utilizantes · média mensal" pre={dados.pre?.utilizantes_media_mensal ?? null} pos={dados.pos?.utilizantes_media_mensal ?? null} delta={deltaUtilizantes} formatar={(v) => formatadorInteiro.format(v)} />
        </div>
        {dados.trimestres_utilizantes.length ? (
          <div className={styles.chipRow}>
            <span className={styles.chipRowLabel}>Utilizantes únicos/trimestre (data do atendimento):</span>
            {dados.trimestres_utilizantes.map((t) => {
              // Completo/parcial vem do MESMO sinal de fechamento que o resto
              // da aba (kpis.ultimo_mes_fechado) — não da posição do item no
              // array. Um trimestre no fim da lista que já fechou (ex.: dado
              // atrasado que só preenche depois) não pode ser rotulado
              // "parcial" só por ser o último a aparecer.
              const completo = trimestreCompleto(t.trimestre, ultimoMesFechado);
              return (
                <span key={t.trimestre} className={`${styles.quarterChip} ${completo ? "" : styles.quarterChipPartial}`}>
                  {t.trimestre} · {t.utilizantes === null ? "—" : formatadorInteiro.format(t.utilizantes)}
                  {completo ? "" : " (parcial)"}
                </span>
              );
            })}
          </div>
        ) : null}
        <p className={styles.methodNote}>
          <strong>Metodologia (do servidor): </strong>
          {dados.metodologia || "não informada"}
        </p>
      </article>
    </LineageAnchor>
  );
}

function StatFlow({
  label,
  pre,
  pos,
  delta,
  formatar,
}: {
  label: string;
  pre: number | null;
  pos: number | null;
  delta: number | null;
  formatar: (value: number) => string;
}) {
  return (
    <div className={styles.statTile}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.flowRow}>
        <span>{pre === null ? "—" : formatar(pre)}</span>
        <i className="fa-solid fa-arrow-right-long" aria-hidden="true" />
        <span>{pos === null ? "—" : formatar(pos)}</span>
        <DeltaChip value={delta} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// comparacao_madura (B7) — narrado a partir do handler.

type JanelaMadura = {
  familias: number;
  itens: number;
  sinistro: number;
  pronto_socorro: number;
  internacao: number;
  consulta: number;
  terapia: number;
  sinistro_medio_mensal: number;
  itens_medio_mensal: number;
  sinistro_por_familia_mes: number | null;
  itens_por_familia_mes: number | null;
};

type DeltasMadura = {
  sinistro_medio_mensal: number | null;
  itens_medio_mensal: number | null;
  sinistro_por_familia_mes: number | null;
  itens_por_familia_mes: number | null;
  pronto_socorro: number | null;
  internacao: number | null;
  consulta: number | null;
  terapia: number | null;
};

type ComparacaoMadura = {
  metodologia: string;
  before_meses: string[];
  after_meses: string[];
  familias_comuns: number | null;
  before: JanelaMadura | null;
  after: JanelaMadura | null;
  deltas_pct: DeltasMadura;
};

function janelaMaduraOrNull(value: unknown): JanelaMadura | null {
  if (!value || typeof value !== "object") return null;
  const bruto = value as Record<string, unknown>;
  const campos = [
    "familias",
    "itens",
    "sinistro",
    "pronto_socorro",
    "internacao",
    "consulta",
    "terapia",
    "sinistro_medio_mensal",
    "itens_medio_mensal",
  ] as const;
  const valores = Object.fromEntries(campos.map((campo) => [campo, numOrNull(bruto[campo])]));
  if (campos.some((campo) => valores[campo] === null)) return null;
  return {
    familias: valores.familias as number,
    itens: valores.itens as number,
    sinistro: valores.sinistro as number,
    pronto_socorro: valores.pronto_socorro as number,
    internacao: valores.internacao as number,
    consulta: valores.consulta as number,
    terapia: valores.terapia as number,
    sinistro_medio_mensal: valores.sinistro_medio_mensal as number,
    itens_medio_mensal: valores.itens_medio_mensal as number,
    sinistro_por_familia_mes: numOrNull(bruto.sinistro_por_familia_mes),
    itens_por_familia_mes: numOrNull(bruto.itens_por_familia_mes),
  };
}

function parseComparacaoMadura(raw: GoldPreview["comparacao_madura"]): ComparacaoMadura {
  const bruto = raw as Record<string, unknown>;
  const deltasBruto = (bruto.deltas_pct && typeof bruto.deltas_pct === "object" ? bruto.deltas_pct : {}) as Record<string, unknown>;
  return {
    metodologia: strOrEmpty(bruto.metodologia),
    before_meses: strArray(bruto.before_meses),
    after_meses: strArray(bruto.after_meses),
    familias_comuns: numOrNull(bruto.familias_comuns),
    before: janelaMaduraOrNull(bruto.before),
    after: janelaMaduraOrNull(bruto.after),
    deltas_pct: {
      sinistro_medio_mensal: numOrNull(deltasBruto.sinistro_medio_mensal),
      itens_medio_mensal: numOrNull(deltasBruto.itens_medio_mensal),
      sinistro_por_familia_mes: numOrNull(deltasBruto.sinistro_por_familia_mes),
      itens_por_familia_mes: numOrNull(deltasBruto.itens_por_familia_mes),
      pronto_socorro: numOrNull(deltasBruto.pronto_socorro),
      internacao: numOrNull(deltasBruto.internacao),
      consulta: numOrNull(deltasBruto.consulta),
      terapia: numOrNull(deltasBruto.terapia),
    },
  };
}

const TIPOS_EVENTO: { label: string; campo: keyof Pick<JanelaMadura, "pronto_socorro" | "internacao" | "consulta" | "terapia">; deltaCampo: keyof DeltasMadura }[] = [
  { label: "Pronto Socorro", campo: "pronto_socorro", deltaCampo: "pronto_socorro" },
  { label: "Internação", campo: "internacao", deltaCampo: "internacao" },
  { label: "Consulta", campo: "consulta", deltaCampo: "consulta" },
  { label: "Terapia", campo: "terapia", deltaCampo: "terapia" },
];

// Leitura executiva: mesma lógica de renderComparacaoMadura (gold-preview.js)
// — descreve frequência (itens/família/mês) e severidade (sinistro/família/mês)
// e destaca o tipo de evento com maior variação absoluta. Nenhum número aqui
// é inventado: tudo deriva de deltas_pct, que já vem pronto do payload.
function leituraExecutiva(dados: ComparacaoMadura): string {
  const freq = dados.deltas_pct.itens_por_familia_mes;
  const sev = dados.deltas_pct.sinistro_por_familia_mes;
  const freqTexto = freq === null ? "frequência por família indisponível" : `a frequência por família ${freq <= 0 ? "caiu" : "subiu"} ${formatadorPercentual.format(Math.abs(freq))}%`;
  const sevTexto = sev === null ? "severidade indisponível" : `o sinistro por família/mês ${sev <= 0 ? "caiu" : "subiu"} ${formatadorPercentual.format(Math.abs(sev))}%`;

  const movimentos = TIPOS_EVENTO
    .map((tipo) => ({ label: tipo.label, valor: dados.deltas_pct[tipo.deltaCampo] }))
    .filter((m): m is { label: string; valor: number } => m.valor !== null)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const maior = movimentos[0];
  const maiorTexto = maior
    ? ` O maior movimento entre os eventos monitorados foi ${maior.label}: ${maior.valor <= 0 ? "queda" : "alta"} de ${formatadorPercentual.format(Math.abs(maior.valor))}%.`
    : "";

  return `No cohort estável, ${freqTexto} e ${sevTexto}.${maiorTexto}`;
}

function MatureComparisonBlock({ comparacao }: { comparacao: GoldPreview["comparacao_madura"] }) {
  const dados = parseComparacaoMadura(comparacao);

  return (
    <LineageAnchor lineageId="claims.mature-comparison" label="Comparação madura 4+4 meses">
      <article className={styles.card}>
        <div className={styles.cardHeaderRow}>
          <div className={styles.cardTitle}>
            <h3>Comparação madura 4+4 meses</h3>
            <p>
              {intervaloMeses(dados.before_meses)} × {intervaloMeses(dados.after_meses)} · mesmas famílias presentes nos dois lados · normalizado por mês.
            </p>
          </div>
          <span className={styles.chipOk}>
            {dados.familias_comuns === null ? "—" : `${formatadorInteiro.format(dados.familias_comuns)} famílias comparáveis`}
          </span>
        </div>
        <div className={`${styles.statGrid} ${styles.statGrid4}`}>
          <StatCompare label="Sinistro · média mensal" pre={dados.before?.sinistro_medio_mensal ?? null} pos={dados.after?.sinistro_medio_mensal ?? null} delta={dados.deltas_pct.sinistro_medio_mensal} formatar={(v) => moedaCompacta.format(v)} />
          <StatCompare label="Itens · média mensal" pre={dados.before?.itens_medio_mensal ?? null} pos={dados.after?.itens_medio_mensal ?? null} delta={dados.deltas_pct.itens_medio_mensal} formatar={(v) => formatadorInteiro.format(v)} />
          <StatCompare label="Sinistro / família / mês" pre={dados.before?.sinistro_por_familia_mes ?? null} pos={dados.after?.sinistro_por_familia_mes ?? null} delta={dados.deltas_pct.sinistro_por_familia_mes} formatar={(v) => moedaCheia.format(v)} />
          <StatCompare label="Itens / família / mês" pre={dados.before?.itens_por_familia_mes ?? null} pos={dados.after?.itens_por_familia_mes ?? null} delta={dados.deltas_pct.itens_por_familia_mes} formatar={(v) => formatadorDecimal.format(v)} />
        </div>
        <div className={styles.splitGrid}>
          <div>
            <p className={styles.subpanelTitle}>Mudança por tipo de evento</p>
            <table className={`${styles.table} ${styles.tableSmall}`}>
              <thead>
                <tr>
                  <th scope="col" className={styles.txt}>Evento</th>
                  <th scope="col" className={styles.num}>Before</th>
                  <th scope="col" className={styles.num}>After</th>
                  <th scope="col" className={styles.num}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {TIPOS_EVENTO.map((tipo) => {
                  const { texto, classe } = deltaLabel(dados.deltas_pct[tipo.deltaCampo]);
                  return (
                    <tr key={tipo.campo}>
                      <td className={styles.txt}>{tipo.label}</td>
                      <td className={styles.num}>{dados.before ? formatadorInteiro.format(dados.before[tipo.campo]) : "—"}</td>
                      <td className={styles.num}>{dados.after ? formatadorInteiro.format(dados.after[tipo.campo]) : "—"}</td>
                      <td className={`${styles.num} ${classe}`}>{texto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.insight}>
            <p className={styles.insightLabel}>Leitura executiva automática</p>
            <p>{leituraExecutiva(dados)}</p>
            <p className={styles.insightCaveat}>
              <strong>Metodologia (do servidor): </strong>
              {dados.metodologia || "não informada"}
            </p>
          </div>
        </div>
      </article>
    </LineageAnchor>
  );
}

function StatCompare({
  label,
  pre,
  pos,
  delta,
  formatar,
}: {
  label: string;
  pre: number | null;
  pos: number | null;
  delta: number | null;
  formatar: (value: number) => string;
}) {
  const { texto, classe } = deltaLabel(delta);
  return (
    <div className={styles.statTile}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.flowRow}>
        <span>{pre === null ? "—" : formatar(pre)}</span>
        <i className="fa-solid fa-arrow-right-long" aria-hidden="true" />
        <span>{pos === null ? "—" : formatar(pos)}</span>
      </div>
      <div className={`${styles.statHelper} ${classe}`}>{texto}</div>
    </div>
  );
}

export function SanusImpact({
  impacto,
  comparacao,
  ultimoMesFechado,
}: {
  impacto: GoldPreview["impacto_sanus"];
  comparacao: GoldPreview["comparacao_madura"];
  ultimoMesFechado: string | null;
}) {
  return (
    <div className={styles.chartStack}>
      <SanusImpactBlock impacto={impacto} ultimoMesFechado={ultimoMesFechado} />
      <MatureComparisonBlock comparacao={comparacao} />
    </div>
  );
}
