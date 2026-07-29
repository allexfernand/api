"use client";

// Modal de linhagem compartilhado pela Análise Sinistro e pela Visão 360.
// A abertura ocorre pelo selo de cada bloco e a navegação entre entradas
// relacionadas acontece dentro do próprio modal.

import { useEffect, useRef } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { useLineage } from "./LineageProvider";

const LAYER_LABEL: Record<string, string> = {
  silver: "Silver",
  gold: "Gold",
  mart: "Mart",
  control: "Controle",
};

export function LineageDrawer() {
  const { enabled, activeId, entry, status, close, open, entries, retry } = useLineage();
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!activeId) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [activeId, close]);

  if (!enabled || !activeId) return null;

  return (
    <div className={`${styles.drawerOverlay} ${styles.lineageOverlay}`} role="presentation" onClick={close}>
      <aside
        className={`${styles.drawer} ${styles.lineageModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lineage-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <div>
            <span className={styles.eyebrow}>Análise Databricks</span>
            <h3 id="lineage-modal-title">{entry?.label ?? "Linhagem"}</h3>
            <p>{entry ? `Camada ${LAYER_LABEL[entry.layer] ?? entry.layer}` : "Origem dos dados no Databricks"}</p>
          </div>
          <button type="button" ref={closeButton} onClick={close} aria-label="Fechar linhagem">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className={`${styles.drawerBody} ${styles.lineageModalBody}`} aria-live="polite">
          {status === "error" ? (
            <div className={styles.blockError} role="alert">
              <strong>Não foi possível carregar a linhagem.</strong>
              <span>O restante do dashboard continua funcionando.</span>
              <button type="button" onClick={retry}>Tentar novamente</button>
            </div>
          ) : status === "loading" ? (
            <div className={styles.blockLoading} role="status">Carregando a linhagem…</div>
          ) : !entry ? (
            <div className={styles.blockEmpty}>
              Linhagem não documentada para este bloco ({activeId}).
            </div>
          ) : (
            <>
              <section className={`${styles.lineageSection} ${styles.lineageFormulaSection}`}>
                <span className={`${styles.lineageLayer} ${styles[`lineageLayer_${entry.layer}`]}`}>
                  {LAYER_LABEL[entry.layer] ?? entry.layer}
                </span>
                <h4>Como é calculado</h4>
                <p className={styles.lineageFormula}>{entry.formula}</p>
              </section>

              <section className={`${styles.lineageSection} ${styles.lineageSourcesSection}`}>
                <h4>Origem no Databricks</h4>
                <ul className={styles.drawerList}>
                  {entry.sources.map((source, index) => (
                    <li key={`${source.object}::${index}`}>
                      <span><code>{source.object}</code></span>
                      <small>{source.role}</small>
                      <div className={styles.lineageColumns}>
                        {source.columns.map((column) => (
                          <code key={column}>{column}</code>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className={styles.lineageSection}>
                <h4>Filtros aplicados</h4>
                <ul className={styles.lineageFilters}>
                  {entry.filters.map((filter) => (
                    <li key={filter}>{filter}</li>
                  ))}
                </ul>
              </section>

              {entry.notes?.length ? (
                <section className={styles.lineageSection}>
                  <h4>Observações</h4>
                  <ul className={styles.lineageNotes}>
                    {entry.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {entry.related?.length ? (
                <section className={`${styles.lineageSection} ${styles.lineageRelatedSection}`}>
                  <h4>Relacionados</h4>
                  <div className={styles.lineageRelated}>
                    {entry.related.map((id) => (
                      <button type="button" key={id} onClick={() => open(id)}>
                        {entries.get(id)?.label ?? id}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
