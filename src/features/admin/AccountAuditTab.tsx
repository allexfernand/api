"use client";

import AuditorChat from "../../../components/auditor/AuditorChat";
import styles from "./SettingsTab.module.css";

export function AccountAuditTab() {
  return (
    <section id="tab-auditoria-contas" className={`tab-content ${styles.root}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>Auditoria de Contas</h2>
        <p className={styles.subtitle}>
          Analise casos assistenciais com apoio dos manuais internos e das normas regulatórias.
        </p>
      </header>

      <AuditorChat />
    </section>
  );
}
