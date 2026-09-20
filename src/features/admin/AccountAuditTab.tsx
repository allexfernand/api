"use client";

import styles from "./SettingsTab.module.css";

export function AccountAuditTab() {
  return (
    <section id="tab-auditoria-contas" className={`tab-content ${styles.root}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>Auditoria de Contas</h2>
        <p className={styles.subtitle}>
          Consulte e acompanhe verificações relacionadas às contas do dashboard.
        </p>
      </header>

      <div className={styles.logsPanel}>
        <div className={styles.sectionIntro}>
          <h3 className={styles.sectionTitle}>Visão administrativa</h3>
          <p className={styles.subtitle}>
            Esta área é visível somente para usuários que possuem acesso à Administração.
          </p>
        </div>
        <div className={styles.fullAccessNotice} role="status">
          Os relatórios de auditoria de contas serão exibidos aqui.
        </div>
      </div>
    </section>
  );
}
