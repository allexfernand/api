"use client";

import { useState } from "react";
import AuditorChat from "../../../components/auditor/AuditorChat";
import DocumentManager from "../../../components/auditor/DocumentManager";
import styles from "./SettingsTab.module.css";

export function AccountAuditTab() {
  const [section, setSection] = useState<"analysis" | "documents">("analysis");

  return (
    <section id="tab-auditoria-contas" className={`tab-content ${styles.root}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>Auditoria de Contas</h2>
        <p className={styles.subtitle}>
          Analise casos assistenciais com apoio dos manuais internos e das normas regulatórias.
        </p>
      </header>

      <nav className={styles.subnav} aria-label="Seções da Auditoria de Contas">
        <button
          type="button"
          className={`${styles.subnavItem} ${section === "analysis" ? styles.subnavItemActive : ""}`}
          aria-current={section === "analysis" ? "page" : undefined}
          onClick={() => setSection("analysis")}
        >
          Análises
        </button>
        <button
          type="button"
          className={`${styles.subnavItem} ${section === "documents" ? styles.subnavItemActive : ""}`}
          aria-current={section === "documents" ? "page" : undefined}
          onClick={() => setSection("documents")}
        >
          Documentos
        </button>
      </nav>

      {section === "analysis" ? <AuditorChat /> : <DocumentManager />}
    </section>
  );
}
