"use client";

// Concentração de custo: Top 1/5/10/10%, pessoas para 50%/80% do custo e
// recorrência do Top 10 entre meses.

import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, LineChart, SERIES_PALETTE } from "./charts";
import type { ConcentrationData } from "../types";
import { monthLabel, number, percent } from "../types";

export function ConcentrationAnalysis({ data, periodLabel }: { data: ConcentrationData; periodLabel: string }) {
  const monthly = data.monthly;
  const last = monthly.at(-1);
  const series = [
    { name: "Top 1", key: "top1_share" as const },
    { name: "Top 5", key: "top5_share" as const },
    { name: "Top 10", key: "top10_share" as const },
    { name: "Top 10%", key: "top10pct_share" as const },
  ].map((entry, index) => ({
    name: entry.name,
    color: SERIES_PALETTE[index % SERIES_PALETTE.length],
    unit: "%",
    points: monthly.map((month) => ({ x: month.month, y: month[entry.key] === null ? null : (month[entry.key] as number) * 100 })),
  }));

  return (
    <div className={styles.twoColumns}>
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Evolução da concentração</h3>
          <p>Participação dos maiores utilizantes no custo de cada mês.</p>
        </div>
        <ChartCard
          title="Concentração mensal"
          unit="% do custo do mês"
          periodLabel={periodLabel}
          chart={
            <LineChart
              series={series}
              formatValue={(value) => `${percent.format(value)}%`}
              ariaLabel="Evolução mensal da concentração de custo"
            />
          }
          legend={<ChartLegend items={series.map((entry) => ({ name: entry.name, color: entry.color }))} />}
          table={
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">Mês</th><th scope="col" className={styles.num}>Top 1</th><th scope="col" className={styles.num}>Top 5</th><th scope="col" className={styles.num}>Top 10</th><th scope="col" className={styles.num}>Top 10%</th><th scope="col" className={styles.num}>Pessoas p/ 50%</th><th scope="col" className={styles.num}>Pessoas p/ 80%</th></tr>
              </thead>
              <tbody>
                {monthly.map((month) => (
                  <tr key={month.month}>
                    <td>{monthLabel(month.month)}</td>
                    <td className={styles.num}>{month.top1_share === null ? "—" : `${percent.format(month.top1_share * 100)}%`}</td>
                    <td className={styles.num}>{month.top5_share === null ? "—" : `${percent.format(month.top5_share * 100)}%`}</td>
                    <td className={styles.num}>{month.top10_share === null ? "—" : `${percent.format(month.top10_share * 100)}%`}</td>
                    <td className={styles.num}>{month.top10pct_share === null ? "—" : `${percent.format(month.top10pct_share * 100)}%`}</td>
                    <td className={styles.num}>{month.people_to_50pct === null ? "—" : number.format(month.people_to_50pct)}</td>
                    <td className={styles.num}>{month.people_to_80pct === null ? "—" : number.format(month.people_to_80pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </article>
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Leitura do último mês da janela</h3>
          <p>{last ? monthLabel(last.month) : "Sem meses aprovados"}</p>
        </div>
        {last ? (
          <div className={styles.psSummary}>
            <div><strong>{last.top10_share === null ? "—" : `${percent.format(last.top10_share * 100)}%`}</strong><span>do custo vem do Top 10</span></div>
            <div><strong>{last.people_to_50pct === null ? "—" : number.format(last.people_to_50pct)}</strong><span>pessoas explicam 50% do custo</span></div>
            <div><strong>{last.people_to_80pct === null ? "—" : number.format(last.people_to_80pct)}</strong><span>pessoas explicam 80% do custo</span></div>
            <div><strong>{number.format(last.top10_recurrent_from_previous_month)}/10</strong><span>do Top 10 já estavam no Top 10 anterior</span></div>
            <div><strong>{number.format(last.utilizers)}</strong><span>utilizantes no mês</span></div>
          </div>
        ) : (
          <div className={styles.blockEmpty}>Sem dados de concentração na janela.</div>
        )}
      </article>
    </div>
  );
}
