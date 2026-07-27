"use client";

// B8 do fragmento legado (src/dashboard/fragments/gold-preview.html linhas
// 196-213) e public/scripts/gold-preview.js, função renderJornada: alcance
// por serviço digital Sanus e proximidade temporal com o sinistro.
//
// `jornada_sanus` chega como z.object({}).passthrough() no contrato — o
// shape real só existe no handler (src/server/routes/gold-preview.ts, chave
// `jornada_sanus`). Narrado aqui com o mesmo padrão defensivo usado em
// SanusImpact.tsx/FacetPanel.opcoesDoCampo.
//
// A ponte para a coordenação Sanus é por family_key (empresa + CPF do
// TITULAR, nunca exposto) — contato digital de um dependente não casa com a
// família. Essa cobertura parcial vem descrita no texto de metodologia do
// próprio payload (jornada_sanus.metodologia) e é reproduzida na tela sem
// paráfrase, a mesma ressalva do bloco de coordenação da Visão 360
// (care-timeline.matrix).

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { LineageAnchor } from "../../sinistralidade/components/LineageAnchor";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatadorDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const SERVICO_LABEL: Record<string, string> = {
  consulta_digital: "Consulta digital",
  ps_digital: "PS digital",
  healthcoach: "HealthCoach",
  qualquer_servico: "Qualquer serviço",
};

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type ServicoJornada = { servico: string; eventos: number | null; familias: number | null; familias_cohort: number | null; alcance_pct: number | null };
type Proximidade = {
  utilizacoes_cohort: number | null;
  utilizacoes_ate_40d: number | null;
  mesmo_dia: number | null;
  ate_7d: number | null;
  ate_15d: number | null;
  ate_40d: number | null;
  media_dias: number | null;
  familias_com_proximidade: number | null;
  share_ate_40d: number | null;
};
type JornadaSanus = {
  metodologia: string;
  servicos: ServicoJornada[];
  proximidade: Proximidade;
};

function parseServico(value: unknown): ServicoJornada | null {
  if (!value || typeof value !== "object") return null;
  const bruto = value as Record<string, unknown>;
  return {
    servico: strOrEmpty(bruto.servico),
    eventos: numOrNull(bruto.eventos),
    familias: numOrNull(bruto.familias),
    familias_cohort: numOrNull(bruto.familias_cohort),
    alcance_pct: numOrNull(bruto.alcance_pct),
  };
}

function parseProximidade(value: unknown): Proximidade {
  const bruto = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    utilizacoes_cohort: numOrNull(bruto.utilizacoes_cohort),
    utilizacoes_ate_40d: numOrNull(bruto.utilizacoes_ate_40d),
    mesmo_dia: numOrNull(bruto.mesmo_dia),
    ate_7d: numOrNull(bruto.ate_7d),
    ate_15d: numOrNull(bruto.ate_15d),
    ate_40d: numOrNull(bruto.ate_40d),
    media_dias: numOrNull(bruto.media_dias),
    familias_com_proximidade: numOrNull(bruto.familias_com_proximidade),
    share_ate_40d: numOrNull(bruto.share_ate_40d),
  };
}

function parseJornadaSanus(raw: GoldPreview["jornada_sanus"]): JornadaSanus {
  const bruto = raw as Record<string, unknown>;
  const servicosBruto = Array.isArray(bruto.servicos) ? bruto.servicos : [];
  return {
    metodologia: strOrEmpty(bruto.metodologia),
    servicos: servicosBruto.map(parseServico).filter((s): s is ServicoJornada => s !== null),
    proximidade: parseProximidade(bruto.proximidade),
  };
}

function servicoLabel(servico: string): string {
  return SERVICO_LABEL[servico] ?? servico;
}

export function SanusJourney({ jornada }: { jornada: GoldPreview["jornada_sanus"] }) {
  const dados = parseJornadaSanus(jornada);
  const total = dados.servicos.find((s) => s.servico === "qualquer_servico");
  const canais = dados.servicos.filter((s) => s.servico !== "qualquer_servico");
  const prox = dados.proximidade;
  const baseFunil = prox.utilizacoes_cohort ?? 0;
  const funil: { label: string; valor: number | null }[] = [
    { label: "Mesmo dia", valor: prox.mesmo_dia },
    { label: "Até 7 dias", valor: prox.ate_7d },
    { label: "Até 15 dias", valor: prox.ate_15d },
    { label: "Até 40 dias", valor: prox.ate_40d },
  ];

  return (
    <LineageAnchor lineageId="claims.sanus-journey" label="Alcance e proximidade da jornada Sanus">
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Alcance e proximidade da jornada Sanus</h3>
          <p>Recuperado do BI antigo com regra auditável: cpf_atendido ↔ cpf_titular · janela 12m fechados.</p>
        </div>
        <div className={styles.journeyGrid}>
          <div className={styles.subpanel}>
            <div className={styles.subpanelHead}>
              <p className={styles.subpanelTitle}>Famílias utilizantes alcançadas</p>
              <strong className={styles.journeyValue}>{total?.alcance_pct == null ? "—" : `${formatadorPercentual.format(total.alcance_pct)}%`}</strong>
            </div>
            <p className={styles.statHelper}>
              {total && total.familias !== null && total.familias_cohort !== null && total.eventos !== null
                ? `${formatadorInteiro.format(total.familias)} de ${formatadorInteiro.format(total.familias_cohort)} famílias utilizantes · ${formatadorInteiro.format(total.eventos)} contatos`
                : "Qualquer serviço digital mapeado"}
            </p>
            <table className={`${styles.table} ${styles.tableSmall}`}>
              <thead>
                <tr>
                  <th scope="col" className={styles.txt}>Canal</th>
                  <th scope="col" className={styles.num}>Famílias</th>
                  <th scope="col" className={styles.num}>Eventos</th>
                  <th scope="col" className={styles.num}>Alcance</th>
                </tr>
              </thead>
              <tbody>
                {canais.map((canal) => (
                  <tr key={canal.servico}>
                    <td className={styles.txt}>{servicoLabel(canal.servico)}</td>
                    <td className={styles.num}>{canal.familias === null ? "—" : formatadorInteiro.format(canal.familias)}</td>
                    <td className={styles.num}>{canal.eventos === null ? "—" : formatadorInteiro.format(canal.eventos)}</td>
                    <td className={styles.num}>{canal.alcance_pct === null ? "—" : `${formatadorPercentual.format(canal.alcance_pct)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.subpanel}>
            <div className={styles.subpanelHead}>
              <p className={styles.subpanelTitle}>Utilizações após contato digital</p>
              <strong className={styles.journeyValue}>{prox.share_ate_40d === null ? "—" : `${formatadorPercentual.format(prox.share_ate_40d)}%`}</strong>
            </div>
            <p className={styles.statHelper}>
              {prox.utilizacoes_ate_40d !== null && prox.utilizacoes_cohort !== null
                ? `${formatadorInteiro.format(prox.utilizacoes_ate_40d)} de ${formatadorInteiro.format(prox.utilizacoes_cohort)} utilizações · média ${prox.media_dias === null ? "—" : formatadorDecimal.format(prox.media_dias)} dias`
                : "Até 40 dias após o contato mais próximo"}
            </p>
            <div className={styles.funnelStack}>
              {funil.map((etapa) => {
                const pct = baseFunil && etapa.valor !== null ? (100 * etapa.valor) / baseFunil : null;
                return (
                  <div className={styles.funnelRow} key={etapa.label}>
                    <div className={styles.funnelHead}>
                      <span>{etapa.label}</span>
                      <strong>{etapa.valor === null ? "—" : `${formatadorInteiro.format(etapa.valor)} · ${pct === null ? "—" : `${formatadorPercentual.format(pct)}%`}`}</strong>
                    </div>
                    <div className={styles.funnelTrack}>
                      <div className={styles.funnelFill} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <p className={styles.methodNote}>
          <strong>Metodologia (do servidor): </strong>
          {dados.metodologia || "não informada"}
        </p>
      </article>
    </LineageAnchor>
  );
}
