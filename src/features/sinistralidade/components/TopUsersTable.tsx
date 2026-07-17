"use client";

// Ranking longitudinal de beneficiários mascarados: posição, variação,
// demografia permitida, serviços, internações, custo, participação,
// recorrência e sparkline mensal. Sem identidade direta.

import { useState } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { SEMANTIC_COLORS, Sparkline } from "./charts";
import type { TopUsersData } from "../types";
import { money, number, percent } from "../types";

export type RankingBy = "cost" | "services" | "hospitalizations";

export function TopUsersTable({
  data,
  rankingBy,
  limit,
  onRankingByChange,
  onLimitChange,
  onSelect,
  canOpenDetail,
}: {
  data: TopUsersData;
  rankingBy: RankingBy;
  limit: 10 | 20;
  onRankingByChange: (value: RankingBy) => void;
  onLimitChange: (value: 10 | 20) => void;
  onSelect: (entityKey: string) => void;
  canOpenDetail: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? data.rows : data.rows.slice(0, 10);
  return (
    <article className={styles.card}>
      <div className={styles.cardHeaderRow}>
        <div className={styles.cardTitle}>
          <h3>Maiores utilizantes da janela</h3>
          <p>Códigos mascarados; a série mensal acompanha o beneficiário mesmo fora do Top 10 do mês.</p>
        </div>
        <div className={styles.rankingControls}>
          <label>Ordenar por
            <select className="filter-select" value={rankingBy} onChange={(event) => onRankingByChange(event.target.value as RankingBy)}>
              <option value="cost">Custo</option>
              <option value="services">Serviços</option>
              <option value="hospitalizations">Internações</option>
            </select>
          </label>
          <label>Limite
            <select className="filter-select" value={limit} onChange={(event) => onLimitChange(Number(event.target.value) as 10 | 20)}>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
            </select>
          </label>
        </div>
      </div>
      <div className={`${styles.tableWrap} ${styles.tableScroll}`}>
        <table className={`${styles.table} ${styles.stickyHead}`}>
          <thead>
            <tr>
              <th scope="col">Posição</th>
              <th scope="col">Beneficiário</th>
              <th scope="col">Faixa etária</th>
              <th scope="col">Vínculo</th>
              <th scope="col">Evento principal</th>
              <th scope="col">Recorrência</th>
              <th scope="col">Curva mensal (custo)</th>
              <th scope="col" className={styles.num}>Serviços</th>
              <th scope="col" className={styles.num}>Internações</th>
              <th scope="col" className={styles.num}>Custo (R$)</th>
              <th scope="col" className={styles.num}>Participação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entity_key}>
                <td>
                  <span className={styles.rankNumber}>{row.position}</span>{" "}
                  {row.is_new_entrant ? (
                    <small className={styles.newEntrant}>novo</small>
                  ) : row.position_delta ? (
                    <small className={row.position_delta > 0 ? styles.positive : styles.negative}>
                      {row.position_delta > 0 ? `↑${row.position_delta}` : `↓${Math.abs(row.position_delta)}`}
                    </small>
                  ) : (
                    <small>=</small>
                  )}
                </td>
                <td>
                  {canOpenDetail ? (
                    <button type="button" className={styles.linkButton} onClick={() => onSelect(row.entity_key)}>
                      {row.label}
                    </button>
                  ) : (
                    <strong>{row.label}</strong>
                  )}
                </td>
                <td>{row.age_group || "—"}</td>
                <td>{row.relationship || "—"}</td>
                <td>{row.primary_event || "—"}</td>
                <td>{row.months_with_usage} de {row.monthly.length} meses</td>
                <td>
                  <Sparkline
                    values={row.monthly.map((entry) => entry.gross_cost)}
                    color={SEMANTIC_COLORS.cost}
                    ariaLabel={`Custo mensal de ${row.label}`}
                  />
                </td>
                <td className={styles.num}>{number.format(row.service_quantity)}</td>
                <td className={styles.num}>{number.format(row.hospitalization_episodes)}</td>
                <td className={styles.num}>{money.format(row.gross_cost)}</td>
                <td className={styles.num}>{row.cost_share === null ? "—" : `${percent.format(row.cost_share * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length > 10 ? (
        <button type="button" className={styles.tableToggle} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Mostrar Top 10" : `Mostrar todos (${data.rows.length})`}
        </button>
      ) : null}
      {!canOpenDetail ? (
        <p className={styles.methodNote}>O detalhe individual exige permissão clínica específica e é carregado sob demanda com auditoria.</p>
      ) : null}
    </article>
  );
}
