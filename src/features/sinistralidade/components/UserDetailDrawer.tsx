"use client";

// Drawer lateral do beneficiário (nível 3): evolução mensal, composição por
// evento, procedimentos, prestadores e internações. Carregado sob demanda,
// somente com permissão clínica; todo acesso é auditado no servidor.

import { useEffect, useRef } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { BlockState } from "./BlockState";
import { SEMANTIC_COLORS, Sparkline } from "./charts";
import { scopeUrl, useSinistralidadeScope } from "../hooks/useSinistralidadeScope";
import type { SinistralidadeFilters } from "../hooks/useSinistralidadeFilters";
import type { UserDetailData } from "../types";
import { money, moneyFull, monthLabel, number } from "../types";

export function UserDetailDrawer({
  entityKey,
  filters,
  onClose,
}: {
  entityKey: string | null;
  filters: SinistralidadeFilters;
  onClose: () => void;
}) {
  const result = useSinistralidadeScope<UserDetailData>(
    entityKey
      ? scopeUrl("user-detail", {
          company_key: filters.companyKey,
          end_month: filters.endMonth,
          window_months: filters.windowMonths,
          include_partial: filters.includePartial,
          entity_key: entityKey,
        })
      : null,
  );

  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!entityKey) return;
    // Foco entra no drawer ao abrir e volta ao elemento anterior ao fechar.
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [entityKey, onClose]);

  if (!entityKey) return null;

  return (
    <div className={styles.drawerOverlay} role="presentation" onClick={onClose}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Detalhe do beneficiário"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <div>
            <span className={styles.eyebrow}>Detalhe individual auditado</span>
            <h3>{result.data?.label || `Beneficiário ${entityKey.slice(0, 8)}`}</h3>
            <p>
              {result.data?.age_group || "Faixa etária não informada"} · {result.data?.relationship || "Vínculo não informado"}
            </p>
          </div>
          <button type="button" ref={closeButton} onClick={onClose} aria-label="Fechar detalhe">✕</button>
        </header>
        <BlockState result={result} emptyMessage="Sem consumo registrado na janela selecionada.">
          {(detail) => (
            <div className={styles.drawerBody}>
              <section>
                <h4>Evolução mensal</h4>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Mês</th>
                        <th scope="col">Evento principal</th>
                        <th scope="col" className={styles.num}>Posição no ranking</th>
                        <th scope="col" className={styles.num}>Serviços</th>
                        <th scope="col" className={styles.num}>Internações</th>
                        <th scope="col" className={styles.num}>Custo (R$)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.monthly.map((entry) => (
                        <tr key={entry.month}>
                          <td>{monthLabel(entry.month)}</td>
                          <td>{entry.primary_event || (entry.has_data ? "—" : "sem consumo")}</td>
                          <td className={styles.num}>{entry.rank_position === null ? "—" : `#${entry.rank_position}`}</td>
                          <td className={styles.num}>{number.format(entry.service_quantity)}</td>
                          <td className={styles.num}>{number.format(entry.hospitalization_episodes)}</td>
                          <td className={styles.num}>{moneyFull.format(entry.gross_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Sparkline
                  values={detail.monthly.map((entry) => entry.gross_cost)}
                  color={SEMANTIC_COLORS.cost}
                  ariaLabel="Curva mensal de custo do beneficiário"
                />
              </section>
              <section>
                <h4>Composição por evento</h4>
                <ul className={styles.drawerList}>
                  {detail.events.map((event) => (
                    <li key={event.event_type}>
                      <span>{event.event_type}</span>
                      <strong>{money.format(event.gross_cost)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>Principais procedimentos</h4>
                <ul className={styles.drawerList}>
                  {detail.procedures.map((procedure) => (
                    <li key={procedure.procedure + procedure.macrogroup}>
                      <span>{procedure.procedure} <small>{procedure.macrogroup}</small></span>
                      <strong>{money.format(procedure.gross_cost)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>Principais prestadores</h4>
                <ul className={styles.drawerList}>
                  {detail.providers.map((provider) => (
                    <li key={provider.provider}>
                      <span>{provider.provider}</span>
                      <strong>{money.format(provider.gross_cost)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>Internações</h4>
                {detail.hospitalizations.length ? (
                  <ul className={styles.drawerList}>
                    {detail.hospitalizations.map((episode, index) => (
                      <li key={`${episode.month}-${index}`}>
                        <span>
                          {monthLabel(episode.month)} · {episode.grouping}
                          {episode.mental_health ? " · saúde mental" : ""}
                          {episode.duration_days !== null ? ` · ${number.format(episode.duration_days)} dias` : " · duração não informada"}
                        </span>
                        <strong>{money.format(episode.gross_cost)}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.methodNote}>Sem episódios de internação na janela.</p>
                )}
              </section>
            </div>
          )}
        </BlockState>
      </aside>
    </div>
  );
}
