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
  const selectedCompany = companies.find((company) => company.company_key === filters.companyKey);
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
      <div className={styles.heroMeta}>
        <PeriodBadge envelope={envelope} includePartial={filters.includePartial} />
        <span>{selectedCompany?.operator || "Operadora não informada"}</span>
        <span>Contrato Gold v{envelope?.contract_version || "1.1.0"}</span>
        {envelope?.quality_run_id ? <span>Qualidade: {envelope.quality_run_id}</span> : null}
        {envelope?.updated_at ? <span>Atualização: {new Date(envelope.updated_at).toLocaleDateString("pt-BR")}</span> : null}
        {envelope ? (
          <span className={styles.monthStrip} aria-label="Status dos meses da janela">
            {envelope.effective_period.months.map((entry) => (
              <i
                key={entry.month}
                className={`${styles.monthDot} ${entry.status === "closed" ? styles.monthClosed : entry.status === "partial" ? styles.monthPartial : styles.monthUnknown}`}
                title={`${monthLabel(entry.month)}: ${entry.status === "closed" ? "fechado" : entry.status === "partial" ? "parcial" : "sem gate de fechamento"}`}
              />
            ))}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function PeriodBadge({ envelope, includePartial }: { envelope: LongitudinalEnvelope | null; includePartial: boolean }) {
  if (!envelope) return <span className={styles.pending}>Resolvendo período…</span>;
  if (envelope.state === "valid") return <span className={styles.closed}>Janela com meses fechados</span>;
  if (envelope.state === "partial") return <span className={styles.pending}>Dado observado · não fechado</span>;
  if (envelope.state === "blocked") {
    return <span className={styles.pending}>{includePartial ? "Sem dados na janela" : "Bloqueado: nenhum mês fechado"}</span>;
  }
  return <span className={styles.pending}>Comparação não válida</span>;
}
