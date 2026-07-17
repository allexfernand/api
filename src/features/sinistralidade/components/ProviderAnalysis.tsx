"use client";

// Prestadores: desempenho no período, evolução mensal e rede × reembolso.

import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, LineChart, SEMANTIC_COLORS, SERIES_PALETTE, StackedBarChart } from "./charts";
import type { ProviderTrendsData } from "../types";
import { money, moneyFull, number, percent } from "../types";

export function ProviderAnalysis({ data, periodLabel }: { data: ProviderTrendsData; periodLabel: string }) {
  const months = [...new Set(data.network_split.map((entry) => entry.month))].sort();
  const networkSegments = [
    {
      name: "Rede credenciada",
      color: SEMANTIC_COLORS.cost,
      values: months.map((month) =>
        data.network_split.filter((entry) => entry.month === month && !entry.reimbursement).reduce((total, entry) => total + entry.gross_cost, 0),
      ),
    },
    {
      name: "Reembolso",
      color: SEMANTIC_COLORS.usage,
      values: months.map((month) =>
        data.network_split.filter((entry) => entry.month === month && entry.reimbursement).reduce((total, entry) => total + entry.gross_cost, 0),
      ),
    },
  ];

  return (
    <div className={styles.blockStack}>
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Maiores prestadores do período</h3>
          <p>Custo, utilizantes, serviços, internações e ticket médio; participação acumulada para leitura de concentração.</p>
        </div>
        <div className={`${styles.tableWrap} ${styles.tableScroll}`}>
          <table className={`${styles.table} ${styles.stickyHead}`}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Prestador</th>
                <th scope="col">Tipo</th>
                <th scope="col">Especialidade</th>
                <th scope="col" className={styles.num}>Serviços</th>
                <th scope="col" className={styles.num}>Internações</th>
                <th scope="col" className={styles.num}>Ticket médio</th>
                <th scope="col" className={styles.num}>Custo (R$)</th>
                <th scope="col" className={styles.num}>% acumulado</th>
              </tr>
            </thead>
            <tbody>
              {data.window.map((row) => (
                <tr key={row.entity_key}>
                  <td><span className={styles.rankNumber}>{row.position}</span></td>
                  <td><strong>{row.provider}</strong>{row.reimbursement_cost > 0 ? <small className={styles.newEntrant}> reembolso</small> : null}</td>
                  <td>{row.provider_type}</td>
                  <td>{row.specialty}</td>
                  <td className={styles.num}>{number.format(row.service_quantity)}</td>
                  <td className={styles.num}>{number.format(row.hospitalization_episodes)}</td>
                  <td className={styles.num}>{row.average_ticket === null ? "—" : moneyFull.format(row.average_ticket)}</td>
                  <td className={styles.num}>{moneyFull.format(row.gross_cost)}</td>
                  <td className={styles.num}>{row.cumulative_cost_share === null ? "—" : `${percent.format(row.cumulative_cost_share * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className={styles.twoColumns}>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Evolução dos cinco maiores</h3>
            <p>Custo mensal por prestador dentro da janela.</p>
          </div>
          <ChartCard
            title="Custo mensal por prestador"
            unit="R$"
            periodLabel={periodLabel}
            chart={
              <LineChart
                series={data.series.slice(0, 5).map((entry, index) => ({
                  name: entry.provider,
                  color: SERIES_PALETTE[index % SERIES_PALETTE.length],
                  unit: "R$",
                  points: entry.monthly.map((point) => ({ x: point.month, y: point.gross_cost })),
                }))}
                formatValue={(value) => money.format(value)}
                ariaLabel="Evolução mensal do custo dos cinco maiores prestadores"
              />
            }
            legend={<ChartLegend items={data.series.slice(0, 5).map((entry, index) => ({ name: entry.provider, color: SERIES_PALETTE[index % SERIES_PALETTE.length] }))} />}
            table={
              <table className={styles.table}>
                <thead><tr><th scope="col">Prestador</th><th scope="col" className={styles.txt}>Mês</th><th scope="col" className={styles.num}>Serviços</th><th scope="col" className={styles.num}>Custo (R$)</th></tr></thead>
                <tbody>
                  {data.series.flatMap((entry) =>
                    entry.monthly.map((point) => (
                      <tr key={`${entry.entity_key}-${point.month}`}>
                        <td>{entry.provider}</td>
                        <td className={styles.txt}>{point.month}</td>
                        <td className={styles.num}>{number.format(point.service_quantity)}</td>
                        <td className={styles.num}>{moneyFull.format(point.gross_cost)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            }
          />
        </article>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Rede credenciada × reembolso</h3>
            <p>Custo mensal por origem do atendimento.</p>
          </div>
          <ChartCard
            title="Rede × reembolso"
            unit="R$"
            periodLabel={periodLabel}
            chart={
              <StackedBarChart
                months={months}
                segments={networkSegments}
                formatValue={(value) => money.format(value)}
                ariaLabel="Custo mensal por rede credenciada e reembolso"
              />
            }
            legend={<ChartLegend items={networkSegments.map((segment) => ({ name: segment.name, color: segment.color }))} />}
            table={
              <table className={styles.table}>
                <thead><tr><th scope="col">Mês</th><th scope="col" className={styles.txt}>Origem</th><th scope="col" className={styles.num}>Serviços</th><th scope="col" className={styles.num}>Custo (R$)</th></tr></thead>
                <tbody>
                  {data.network_split.map((entry) => (
                    <tr key={`${entry.month}-${entry.reimbursement}`}>
                      <td>{entry.month}</td>
                      <td className={styles.txt}>{entry.reimbursement ? "Reembolso" : "Rede credenciada"}</td>
                      <td className={styles.num}>{number.format(entry.service_quantity)}</td>
                      <td className={styles.num}>{moneyFull.format(entry.gross_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        </article>
      </div>
    </div>
  );
}
