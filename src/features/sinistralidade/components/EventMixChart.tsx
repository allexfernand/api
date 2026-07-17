"use client";

// Composição mensal do custo por tipo de evento (colunas empilhadas),
// limitada aos cinco maiores eventos + "Demais".

import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, SERIES_PALETTE, StackedBarChart } from "./charts";
import type { EventMixData } from "../types";
import { money, moneyFull, monthLabel, percent } from "../types";

export function EventMixChart({ data, periodLabel }: { data: EventMixData; periodLabel: string }) {
  const months = [...new Set(data.months.map((entry) => entry.month))].sort();
  const topEvents = data.window_totals.slice(0, 5).map((entry) => entry.event_type);
  const segments = [
    ...topEvents.map((eventType, index) => ({
      name: eventType,
      color: SERIES_PALETTE[index % SERIES_PALETTE.length],
      values: months.map((month) =>
        data.months
          .filter((entry) => entry.month === month && entry.event_type === eventType)
          .reduce((total, entry) => total + entry.gross_cost, 0),
      ),
    })),
    {
      name: "Demais eventos",
      color: "#d1d5db",
      values: months.map((month) =>
        data.months
          .filter((entry) => entry.month === month && !topEvents.includes(entry.event_type))
          .reduce((total, entry) => total + entry.gross_cost, 0),
      ),
    },
  ];

  return (
    <article className={styles.card}>
      <div className={styles.cardTitle}>
        <h3>Composição por tipo de evento</h3>
        <p>Custo assistencial bruto por evento comercial, mês a mês.</p>
      </div>
      <ChartCard
        title="Custo por evento"
        unit="R$"
        periodLabel={periodLabel}
        chart={
          <StackedBarChart
            months={months}
            segments={segments}
            formatValue={(value) => money.format(value)}
            ariaLabel="Composição mensal do custo por tipo de evento"
          />
        }
        legend={<ChartLegend items={segments.map((segment) => ({ name: segment.name, color: segment.color }))} />}
        table={
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col" className={styles.txt}>Evento</th>
                <th scope="col" className={styles.num}>Custo (R$)</th>
                <th scope="col" className={styles.num}>Participação no mês</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((entry) => (
                <tr key={`${entry.month}-${entry.event_type}`}>
                  <td>{monthLabel(entry.month)}</td>
                  <td className={styles.txt}>{entry.event_type}</td>
                  <td className={styles.num}>{moneyFull.format(entry.gross_cost)}</td>
                  <td className={styles.num}>{percent.format(entry.month_cost_share * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
    </article>
  );
}
