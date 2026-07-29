"use client";

// Quatro indicadores executivos da aba Análise Sinistro, portados dos cards
// `pg-kpi-*` do fragment (src/dashboard/fragments/gold-preview.html linhas
// 51-58). Os atributos `title=` de cada card carregam a explicação
// O QUE É / POR QUE EXISTE / SINAL / ARMADILHA escrita por quem conhece o
// negócio — preservados na íntegra, sem paráfrase. Nenhum valor numérico é
// hardcoded: tudo vem de `kpis`; ausência (null) vira travessão, nunca zero.
//
// Os quatro cards compartilham o mesmo `lineageId="claims.kpis"`: a entrada
// de linhagem descreve o bloco inteiro (custo, utilizantes e reembolso vêm
// da mesma consulta), não um indicador por vez.

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { monthTick } from "../../sinistralidade/components/charts";
import { LineageAnchor } from "../../sinistralidade/components/LineageAnchor";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorMoedaCompacta = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 2,
});
const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function ExecutiveKpis({ kpis }: { kpis: GoldPreview["kpis"] }) {
  const periodoFechado = kpis.periodo === "closed";
  const mesFechado = kpis.ultimo_mes_fechado ? monthTick(kpis.ultimo_mes_fechado) : "";
  const inicioJanela = kpis.janela_12m[0] ?? null;
  const fimJanela = kpis.janela_12m[kpis.janela_12m.length - 1] ?? null;
  const janelaLabel = inicioJanela && fimJanela ? `${monthTick(inicioJanela)}–${monthTick(fimJanela)}` : "janela 12m";

  return (
    <div className={styles.kpiGrid}>
      <Kpi
        lineageId="claims.kpis"
        label={periodoFechado ? `Sinistro · último mês fechado${mesFechado ? ` (${mesFechado})` : ""}` : "Sinistro · sem mês fechado"}
        value={kpis.sinistro_ultimo_mes_fechado === null ? "—" : formatadorMoedaCompacta.format(kpis.sinistro_ultimo_mes_fechado)}
        helper={periodoFechado ? "mês fechado por gate formal" : "dados observados; sem comparação oficial"}
        title={periodoFechado ? "O QUE É: SUM(sinistro) do último mês formalmente fechado. NÃO É sinistralidade (não temos prêmio na base)." : "Nenhum mês da janela foi formalmente fechado. Os demais indicadores representam dados observados, não uma comparação oficial."}
      />
      <Kpi
        lineageId="claims.kpis"
        label={`Custo por utilizante · ${janelaLabel}${periodoFechado ? "" : " (observado)"}`}
        value={kpis.custo_por_utilizante_12m === null ? "—" : formatadorMoeda.format(kpis.custo_por_utilizante_12m)}
        helper={`${formatadorInteiro.format(kpis.utilizantes_12m)} utilizantes · não é per capita (falta vidas)`}
        title={`O QUE É: SUM(sinistro) ÷ COUNT(DISTINCT person_key) na janela ${periodoFechado ? "fechada" : "observada"}. NÃO é per capita — quem não usou não está na base; per capita real exige vidas elegíveis históricas.`}
      />
      <Kpi
        lineageId="claims.kpis"
        label={periodoFechado ? `Utilizantes no mês${mesFechado ? ` (${mesFechado})` : ""}` : "Utilizantes · janela observada"}
        value={kpis.utilizantes_ultimo_mes_fechado === null ? "—" : formatadorInteiro.format(kpis.utilizantes_ultimo_mes_fechado)}
        helper="COUNT DISTINCT person_key"
        title={`O QUE É: COUNT(DISTINCT person_key) na ${periodoFechado ? "última competência fechada" : "janela observada"}. A identidade é opaca e resolvida na Gold v2; nunca some utilizantes de meses.`}
      />
      <Kpi
        lineageId="claims.kpis"
        label="Reembolso · share do custo"
        value={kpis.reembolso_share_12m === null ? "—" : `${formatadorPercentual.format(kpis.reembolso_share_12m)}%`}
        helper="proxy de vazamento de rede"
        title="O QUE É: share do custo com flag_reembolso = true nos 12m fechados. POR QUE EXISTE: proxy de vazamento de rede — gasto fora da rede credenciada. SINAL: tendência de alta = rede insuficiente em alguma praça/especialidade (reembolso costuma custar mais que rede)."
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  helper,
  title,
  lineageId,
}: {
  label: string;
  value: string;
  helper: string;
  title: string;
  lineageId?: string;
}) {
  return (
    <LineageAnchor lineageId={lineageId} label={label}>
      <article className={styles.kpi} title={title}>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </article>
    </LineageAnchor>
  );
}
