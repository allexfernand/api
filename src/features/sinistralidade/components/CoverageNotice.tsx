"use client";

// Avisos de cobertura e advertências do envelope: elegibilidade, CID,
// episódio, família, prestador e mensagens do gate de período.

import styles from "../SinistralidadeV2Tab.module.css";
import type { LongitudinalEnvelope } from "../types";
import { percent } from "../types";

export function CoverageNotice({ envelope }: { envelope: LongitudinalEnvelope | null }) {
  if (!envelope) return null;
  const coverage = envelope.coverage;
  const hasWarnings = envelope.warnings.length > 0;
  if (!coverage && !hasWarnings) return null;
  return (
    <aside className={styles.coverageNotice} aria-label="Cobertura e advertências">
      {coverage ? (
        <div className={styles.coverageRow}>
          <CoverageChip label="Pessoa" value={coverage.person} />
          <CoverageChip label="Episódio" value={coverage.episode} />
          <CoverageChip label="Família" value={coverage.family} />
          <CoverageChip label="Procedimento" value={coverage.procedure} />
          <CoverageChip label="Prestador" value={coverage.provider} />
          <CoverageChip label="CID" value={coverage.cid} />
          <span className={styles.coverageChipMuted}>
            Elegibilidade: {coverage.eligibility === "available" ? "disponível" : coverage.eligibility === "partial" ? "parcial" : "indisponível no histórico"}
          </span>
        </div>
      ) : null}
      {hasWarnings ? (
        <ul className={styles.warningList}>
          {envelope.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function CoverageChip({ label, value }: { label: string; value: number | null }) {
  if (value === null) return <span className={styles.coverageChipMuted}>{label}: sem medição</span>;
  const low = value < 0.9;
  return (
    <span className={low ? styles.coverageChipLow : styles.coverageChip}>
      {label}: {percent.format(value * 100)}%
    </span>
  );
}
