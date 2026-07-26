"use client";

// Internações e saúde mental: evolução mensal (episódios distintos),
// agrupamentos e prestadores de internação. Saúde mental fica visualmente
// separada, com o critério de classificação explícito.

import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, LineChart, SEMANTIC_COLORS } from "./charts";
import type { HospitalizationTrendsData } from "../types";
import { money, moneyFull, monthLabel, number, percent } from "../types";

export function HospitalizationAnalysis({ data, periodLabel }: { data: HospitalizationTrendsData; periodLabel: string }) {
  const months = [...new Set(data.monthly.map((entry) => entry.month))].sort();
  const seriesFor = (mental: boolean) =>
    months.map((month) => {
      const found = data.monthly.find((entry) => entry.month === month && entry.mental_health === mental);
      return { x: month, y: found ? found.episodes : 0 };
    });

  const mentalTotal = data.monthly.filter((entry) => entry.mental_health);
  const otherTotal = data.monthly.filter((entry) => !entry.mental_health);
  const sumEpisodes = (rows: typeof data.monthly) => rows.reduce((total, entry) => total + entry.episodes, 0);
  const sumCost = (rows: typeof data.monthly) => rows.reduce((total, entry) => total + entry.total_cost, 0);
  const durationCoverage = data.monthly.length
    ? data.monthly.reduce((total, entry) => total + (entry.duration_coverage ?? 0), 0) / data.monthly.length
    : null;

  return (
    <div className={styles.blockStack}>
      <div className={styles.twoColumns}>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Episódios por mês</h3>
            <p>Episódios distintos por episode_key. Critério de saúde mental: flag clínica da Gold (flag_saude_mental).</p>
          </div>
          <ChartCard
            lineageId="hospitalization-trends.monthly"
            title="Internações mensais"
            unit="episódios"
            periodLabel={periodLabel}
            coverageNote={durationCoverage === null ? null : `Cobertura de duração: ${percent.format(durationCoverage * 100)}%`}
            chart={
              <LineChart
                series={[
                  { name: "Demais internações", color: SEMANTIC_COLORS.hospitalization, unit: "episódios", points: seriesFor(false) },
                  { name: "Saúde mental", color: SEMANTIC_COLORS.mentalHealth, unit: "episódios", points: seriesFor(true) },
                ]}
                formatValue={(value) => number.format(value)}
                ariaLabel="Evolução mensal de episódios de internação, separando saúde mental"
              />
            }
            legend={<ChartLegend items={[{ name: "Demais internações", color: SEMANTIC_COLORS.hospitalization }, { name: "Saúde mental", color: SEMANTIC_COLORS.mentalHealth }]} />}
            table={
              <table className={styles.table}>
                <thead>
                  <tr><th scope="col">Mês</th><th scope="col">Categoria</th><th scope="col" className={styles.num}>Episódios</th><th scope="col" className={styles.num}>Utilizantes</th><th scope="col" className={styles.num}>Custo (R$)</th><th scope="col" className={styles.num}>Custo médio/episódio</th><th scope="col" className={styles.num}>Duração mediana (dias)</th></tr>
                </thead>
                <tbody>
                  {data.monthly.map((entry) => (
                    <tr key={`${entry.month}-${entry.mental_health}`}>
                      <td>{monthLabel(entry.month)}</td>
                      <td>{entry.mental_health ? "Saúde mental" : "Demais internações"}</td>
                      <td className={styles.num}>{number.format(entry.episodes)}</td>
                      <td className={styles.num}>{number.format(entry.utilizers)}</td>
                      <td className={styles.num}>{moneyFull.format(entry.total_cost)}</td>
                      <td className={styles.num}>{entry.average_episode_cost === null ? "—" : moneyFull.format(entry.average_episode_cost)}</td>
                      <td className={styles.num}>{entry.median_duration_days === null ? "—" : number.format(entry.median_duration_days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        </article>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Resumo do período</h3>
            <p>Saúde mental isolada das demais internações.</p>
          </div>
          <div className={styles.mentalGrid}>
            <div className={`${styles.mental} ${styles.mentalAccent}`}>
              <span>Saúde mental</span>
              <strong>{number.format(sumEpisodes(mentalTotal))} episódios</strong>
              <div><small>Custo total</small><b>{money.format(sumCost(mentalTotal))}</b></div>
              <div><small>Participação nas internações</small><b>{sumEpisodes(mentalTotal) + sumEpisodes(otherTotal) > 0 ? `${percent.format((sumCost(mentalTotal) / Math.max(sumCost(mentalTotal) + sumCost(otherTotal), 1)) * 100)}% do custo` : "—"}</b></div>
            </div>
            <div className={styles.mental}>
              <span>Demais internações</span>
              <strong>{number.format(sumEpisodes(otherTotal))} episódios</strong>
              <div><small>Custo total</small><b>{money.format(sumCost(otherTotal))}</b></div>
              <div><small>Custo médio/episódio</small><b>{sumEpisodes(otherTotal) ? moneyFull.format(sumCost(otherTotal) / sumEpisodes(otherTotal)) : "—"}</b></div>
            </div>
          </div>
          <p className={styles.methodNote}>Internações por mil vidas só serão exibidas quando houver denominador de elegibilidade contemporâneo válido em todos os meses da janela.</p>
        </article>
      </div>

      <div className={styles.twoColumns}>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Agrupamentos de internação</h3>
            <p>Ordenado por custo total no período.</p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Agrupamento</th><th scope="col" className={styles.num}>Episódios</th><th scope="col" className={styles.num}>Custo (R$)</th><th scope="col" className={styles.num}>Custo médio</th><th scope="col" className={styles.num}>Duração mediana</th></tr></thead>
              <tbody>
                {data.groups.map((group) => (
                  <tr key={group.grouping}>
                    <td><strong>{group.grouping}</strong></td>
                    <td className={styles.num}>{number.format(group.episodes)}</td>
                    <td className={styles.num}>{moneyFull.format(group.total_cost)}</td>
                    <td className={styles.num}>{group.average_episode_cost === null ? "—" : moneyFull.format(group.average_episode_cost)}</td>
                    <td className={styles.num}>{group.median_duration_days === null ? "—" : `${number.format(group.median_duration_days)} dias`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Prestadores de internação</h3>
            <p>Top 10 por episódios no período.</p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col" className={styles.txt}>Prestador</th><th scope="col" className={styles.num}>Episódios</th><th scope="col" className={styles.num}>Custo (R$)</th></tr></thead>
              <tbody>
                {data.providers.map((provider) => (
                  <tr key={provider.entity_key}>
                    <td className={styles.txt}><strong>{provider.provider}</strong></td>
                    <td className={styles.num}>{number.format(provider.episodes)}</td>
                    <td className={styles.num}>{moneyFull.format(provider.gross_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </div>
  );
}
