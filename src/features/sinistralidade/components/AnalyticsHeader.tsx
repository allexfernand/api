"use client";

// Cabeçalho analítico: empresa, mês final, janela, modo de período e o
// estado real de cada mês da janela em uso.

import styles from "../SinistralidadeV2Tab.module.css";
import type { SinistralidadeFilters, WindowMonths } from "../hooks/useSinistralidadeFilters";
import type { Company, LongitudinalEnvelope } from "../types";
import { monthLabel } from "../types";

export function AnalyticsHeader({
  companies,
  filters,
  windowOptions,
  availableMonths,
  envelope,
  onChange,
}: {
  companies: Company[];
  filters: SinistralidadeFilters;
  windowOptions: WindowMonths[];
  availableMonths: string[];
  envelope: LongitudinalEnvelope | null;
  onChange: (patch: Partial<SinistralidadeFilters>) => void;
}) {
  return (
    <header className={styles.hero}>
      <div className={styles.heroIdentity}>
        <div className={styles.heroIcon} aria-hidden="true"><i className="fa-solid fa-chart-line" /></div>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>Inteligência assistencial multiempresa</div>
          <h1>Sinistralidade 360</h1>
          <p>Evolução longitudinal de custo, utilização, internações e coordenação — do consolidado ao episódio.</p>
        </div>
      </div>
      <div className={`${styles.controls} ${styles.controlsWide}`}>
        <label>Empresa
          <select className="filter-select" value={filters.companyKey} onChange={(event) => onChange({ companyKey: event.target.value })}>
            {companies.map((company) => (
              <option key={company.company_key} value={company.company_key}>{company.name}</option>
            ))}
          </select>
        </label>
        <label>Mês final
          <select className="filter-select" value={filters.endMonth} onChange={(event) => onChange({ endMonth: event.target.value })}>
            {availableMonths.map((month) => (
              <option key={month} value={month}>{monthLabel(month)}</option>
            ))}
          </select>
        </label>
        <label>Janela
          <select className="filter-select" value={filters.windowMonths} onChange={(event) => onChange({ windowMonths: Number(event.target.value) as WindowMonths })}>
            {windowOptions.map((option) => (
              <option key={option} value={option}>{option} meses</option>
            ))}
          </select>
        </label>
        <label>Período
          <select className="filter-select" value={String(filters.includePartial)} onChange={(event) => onChange({ includePartial: event.target.value === "true" })}>
            <option value="false">Somente meses fechados</option>
            <option value="true">Incluir meses observados (parcial)</option>
          </select>
        </label>
      </div>
      {envelope?.updated_at ? (
        <div className={styles.heroMeta}>
          <span>Atualização: {new Date(envelope.updated_at).toLocaleDateString("pt-BR")}</span>
        </div>
      ) : null}
    </header>
  );
}
