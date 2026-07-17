"use client";

// KPIs executivos da janela. Indicadores normalizados só aparecem com
// denominador válido; caso contrário o estado é explícito.

import styles from "../SinistralidadeV2Tab.module.css";
import type { TimelineKpis } from "../types";
import { money, moneyFull, number } from "../types";

export function ExecutiveKpis({ kpis }: { kpis: TimelineKpis | null }) {
  if (!kpis) return <div className={styles.blockEmpty}>Sem meses aprovados na janela para calcular KPIs.</div>;
  const normalizedValid = kpis.normalized_state === "valid";
  return (
    <div className={styles.kpiGrid}>
      <Kpi label="Custo assistencial (janela)" value={money.format(kpis.gross_cost)} helper={`${kpis.months_included} mês(es) incluído(s) · R$`} />
      <Kpi label="Beneficiários utilizantes" value={number.format(kpis.utilizers)} helper="pessoas distintas na janela" />
      <Kpi label="Serviços realizados" value={number.format(kpis.service_quantity)} helper="quantidade de serviços" />
      <Kpi label="Episódios de internação" value={number.format(kpis.hospitalization_episodes)} helper="episódios distintos (episode_key)" />
      <Kpi label="Famílias utilizantes" value={number.format(kpis.utilizing_families)} helper="famílias distintas na janela" />
      <Kpi
        label="Custo por utilizante"
        value={kpis.cost_per_utilizer === null ? "—" : moneyFull.format(kpis.cost_per_utilizer)}
        helper="R$ por pessoa utilizante"
      />
      <Kpi
        label="Serviços por utilizante"
        value={kpis.services_per_utilizer === null ? "—" : number.format(kpis.services_per_utilizer)}
        helper="serviços por pessoa"
      />
      <Kpi
        label="Custo por vida elegível"
        value={normalizedValid && kpis.cost_per_eligible_life !== null ? moneyFull.format(kpis.cost_per_eligible_life) : "Denominador indisponível"}
        helper={normalizedValid ? "R$ por vida elegível" : "sem snapshot contemporâneo em todos os meses"}
        muted={!normalizedValid}
      />
      <Kpi
        label="Internações por mil vidas"
        value={normalizedValid && kpis.hospitalizations_per_thousand_lives !== null ? number.format(kpis.hospitalizations_per_thousand_lives) : "Denominador indisponível"}
        helper={normalizedValid ? "episódios por 1.000 vidas elegíveis" : "sem snapshot contemporâneo em todos os meses"}
        muted={!normalizedValid}
      />
    </div>
  );
}

function Kpi({ label, value, helper, muted }: { label: string; value: string; helper: string; muted?: boolean }) {
  return (
    <article className={`${styles.kpi} ${muted ? styles.mutedKpi : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}
