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

// Mesma técnica de `monthTick` em charts.tsx (MM/AA), para o rótulo do mês
// no card ficar consistente com o eixo X dos gráficos logo abaixo.
function mesCurto(mes: string | null): string {
  return mes ? `${mes.slice(5)}/${mes.slice(2, 4)}` : "";
}

export function ExecutiveKpis({ kpis }: { kpis: GoldPreview["kpis"] }) {
  const mesFechado = mesCurto(kpis.ultimo_mes_fechado);
  const inicioJanela = kpis.janela_12m[0] ?? null;
  const fimJanela = kpis.janela_12m[kpis.janela_12m.length - 1] ?? null;
  const janelaLabel = inicioJanela && fimJanela ? `${mesCurto(inicioJanela)}–${mesCurto(fimJanela)}` : "janela 12m";

  return (
    <div className={styles.kpiGrid}>
      <Kpi
        lineageId="claims.kpis"
        label={`Sinistro · último mês fechado${mesFechado ? ` (${mesFechado})` : ""}`}
        value={kpis.sinistro_ultimo_mes_fechado === null ? "—" : formatadorMoedaCompacta.format(kpis.sinistro_ultimo_mes_fechado)}
        helper="mês fecha em M+2 (lag ~2 meses)"
        title="O QUE É: SUM(sinistro) do último mês com faturamento completo (regra: mês M fecha quando M+2 começa — lag de cobrança ~2 meses). POR QUE EXISTE: é o único mês recente comparável com o histórico. SINAL: comparar com a média 12m; acima disso por 2+ meses = pressão de custo. NÃO É sinistralidade (não temos prêmio na base)."
      />
      <Kpi
        lineageId="claims.kpis"
        label={`Custo por utilizante · ${janelaLabel}`}
        value={kpis.custo_por_utilizante_12m === null ? "—" : formatadorMoeda.format(kpis.custo_por_utilizante_12m)}
        helper={`${formatadorInteiro.format(kpis.utilizantes_12m)} utilizantes · não é per capita (falta vidas)`}
        title="O QUE É: SUM(sinistro) ÷ COUNT(DISTINCT codigo_usuario) nos 12 meses fechados. POR QUE EXISTE: normaliza o custo pelo nº de pessoas que USARAM. NÃO é per capita — quem não usou não está na base; per capita real virá do join com beneficiaries (H4). SINAL: alta = severidade/mix piorando; queda = mix mais leve."
      />
      <Kpi
        lineageId="claims.kpis"
        label={`Utilizantes no mês${mesFechado ? ` (${mesFechado})` : ""}`}
        value={kpis.utilizantes_ultimo_mes_fechado === null ? "—" : formatadorInteiro.format(kpis.utilizantes_ultimo_mes_fechado)}
        helper="COUNT DISTINCT codigo_usuario"
        title="O QUE É: COUNT(DISTINCT codigo_usuario) no último mês fechado. POR QUE EXISTE: mede FREQUÊNCIA (quantas pessoas usaram), separando volume de severidade — se o custo sobe com utilizantes estáveis, o problema é severidade, não frequência. ARMADILHA: nunca somar utilizantes de meses (mesma pessoa conta 2x)."
      />
      <Kpi
        lineageId="claims.kpis"
        label="Reembolso · share do custo"
        value={kpis.reembolso_share_12m === null ? "—" : `${formatadorPercentual.format(kpis.reembolso_share_12m)}%`}
        helper="proxy de vazamento de rede"
        title="O QUE É: share do custo com rede_reembolso='Reembolso' nos 12m fechados. POR QUE EXISTE: proxy de vazamento de rede — gasto fora da rede credenciada. SINAL: tendência de alta = rede insuficiente em alguma praça/especialidade (reembolso costuma custar mais que rede)."
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
