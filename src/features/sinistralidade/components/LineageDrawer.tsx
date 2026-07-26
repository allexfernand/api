"use client";

// Gaveta de linhagem. Diferente do UserDetailDrawer, esta é NÃO-MODAL: sem
// overlay, sem aria-modal e sem prender o foco, porque o usuário precisa
// clicar de um bloco para outro com ela aberta, comparando as origens.

import { useEffect } from "react";
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

  useEffect(() => {
    if (!activeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, close]);

  if (!enabled || !activeId) return null;

  return (
    <aside className={`${styles.drawer} ${styles.lineageDrawer}`} role="complementary" aria-label="Linhagem Databricks">
      <div className={styles.drawerHeader}>
        <div>
          <h3>{entry?.label ?? "Linhagem"}</h3>
          <p>{entry ? `Camada ${LAYER_LABEL[entry.layer] ?? entry.layer}` : "Origem dos dados no Databricks"}</p>
        </div>
        <button type="button" onClick={close} aria-label="Fechar linhagem">
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>

      <div className={styles.drawerBody} aria-live="polite">
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
            <span className={`${styles.lineageLayer} ${styles[`lineageLayer_${entry.layer}`]}`}>
              {LAYER_LABEL[entry.layer] ?? entry.layer}
            </span>

            <h4>Como é calculado</h4>
            <p className={styles.lineageFormula}>{entry.formula}</p>

            <h4>Origem no Databricks</h4>
            <ul className={styles.drawerList}>
              {entry.sources.map((source) => (
                <li key={source.object}>
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

            <h4>Filtros aplicados</h4>
            <ul className={styles.lineageFilters}>
              {entry.filters.map((filter) => (
                <li key={filter}>{filter}</li>
              ))}
            </ul>

            {entry.notes?.length ? (
              <>
                <h4>Observações</h4>
                <ul className={styles.lineageNotes}>
                  {entry.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {entry.related?.length ? (
              <>
                <h4>Relacionados</h4>
                <div className={styles.lineageRelated}>
                  {entry.related.map((id) => (
                    <button type="button" key={id} onClick={() => open(id)}>
                      {entries.get(id)?.label ?? id}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
