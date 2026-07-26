"use client";

// Serviços e procedimentos: rankings (mais usados, mais caros, maior custo
// médio, maior crescimento), Pareto, evolução mensal e dispersão
// volume × custo médio. Linhas, serviços e episódios ficam separados.

import { useState } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, LineChart, ParetoChart, ScatterChart, SERIES_PALETTE } from "./charts";
import type { ProcedureTrendsData, ProcedureWindowRow } from "../types";
import { money, moneyFull, number, percent } from "../types";

type RankView = "most_used" | "most_expensive" | "highest_avg" | "growth";

export function ProcedureAnalysis({ data, periodLabel }: { data: ProcedureTrendsData; periodLabel: string }) {
  const [view, setView] = useState<RankView>("most_expensive");
  const ranked = rankRows(data, view);

  return (
    <div className={styles.blockStack}>
      <article className={styles.card}>
        <div className={styles.cardHeaderRow}>
          <div className={styles.cardTitle}>
            <h3>Rankings de procedimentos</h3>
            <p>Linhas de conta, quantidade de serviços e episódios são medidas distintas.</p>
          </div>
          <div className={styles.metricPicker} role="tablist" aria-label="Critério do ranking">
            {([
              ["most_expensive", "Mais caros"],
              ["most_used", "Mais utilizados"],
              ["highest_avg", "Maior custo médio"],
              ["growth", "Maior crescimento"],
            ] as [RankView, string][]).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? styles.metricActive : undefined} onClick={() => setView(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Procedimento</th>
                <th scope="col">Grupo</th>
                <th scope="col" className={styles.num}>Serviços</th>
                <th scope="col" className={styles.num}>Linhas</th>
                <th scope="col" className={styles.num}>Internações</th>
                <th scope="col" className={styles.num}>Custo médio (R$/serviço)</th>
                <th scope="col" className={styles.num}>{view === "growth" ? "Crescimento M/M" : "Custo (R$)"}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, index) => (
                <tr key={row.entity_key}>
                  <td><span className={styles.rankNumber}>{index + 1}</span></td>
                  <td><strong>{row.description}</strong></td>
                  <td>{row.macrogroup}</td>
                  <td className={styles.num}>{number.format(row.service_quantity)}</td>
                  <td className={styles.num}>{number.format(row.billing_lines)}</td>
                  <td className={styles.num}>{number.format(row.hospitalization_episodes)}</td>
                  <td className={styles.num}>{row.average_cost_per_service === null ? "—" : moneyFull.format(row.average_cost_per_service)}</td>
                  <td className={styles.num}>
                    {view === "growth"
                      ? row.growthLabel
                      : `${moneyFull.format(row.gross_cost)}${row.cost_share !== null ? ` (${percent.format(row.cost_share * 100)}%)` : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className={styles.twoColumns}>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Pareto de custo</h3>
            <p>Participação acumulada dos 20 maiores procedimentos.</p>
          </div>
          <ChartCard
            lineageId="procedure-trends.pareto"
            title="Pareto"
            unit="R$ e % acumulado"
            periodLabel={periodLabel}
            chart={
              <ParetoChart
                items={data.pareto.slice(0, 20).map((entry) => ({ label: entry.description, value: entry.gross_cost, cumulativeShare: entry.cumulative_cost_share }))}
                formatValue={(value) => money.format(value)}
                ariaLabel="Pareto de custo por procedimento"
              />
            }
            table={
              <table className={styles.table}>
                <thead><tr><th scope="col" className={styles.txt}>Procedimento</th><th scope="col" className={styles.num}>Custo (R$)</th><th scope="col" className={styles.num}>% acumulado</th></tr></thead>
                <tbody>
                  {data.pareto.slice(0, 20).map((entry) => (
                    <tr key={entry.entity_key}>
                      <td className={styles.txt}>{entry.description}</td>
                      <td className={styles.num}>{moneyFull.format(entry.gross_cost)}</td>
                      <td className={styles.num}>{entry.cumulative_cost_share === null ? "—" : `${percent.format(entry.cumulative_cost_share * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        </article>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <h3>Volume × custo médio</h3>
            <p>Tamanho da bolha = custo total no período (50 maiores).</p>
          </div>
          <ChartCard
            lineageId="procedure-trends.scatter"
            title="Dispersão"
            unit="serviços × R$/serviço"
            periodLabel={periodLabel}
            chart={
              <ScatterChart
                points={data.window
                  .filter((entry) => entry.average_cost_per_service !== null)
                  .slice(0, 50)
                  .map((entry) => ({ label: entry.description, x: entry.service_quantity, y: entry.average_cost_per_service as number, size: entry.gross_cost }))}
                xLabel="Serviços no período"
                yLabel="Custo médio (R$)"
                ariaLabel="Dispersão de volume por custo médio dos procedimentos"
              />
            }
            table={
              <table className={styles.table}>
                <thead><tr><th scope="col">Procedimento</th><th scope="col">Serviços</th><th scope="col">Custo médio</th><th scope="col">Custo total</th></tr></thead>
                <tbody>
                  {data.window.slice(0, 50).map((entry) => (
                    <tr key={entry.entity_key}>
                      <td>{entry.description}</td>
                      <td>{number.format(entry.service_quantity)}</td>
                      <td>{entry.average_cost_per_service === null ? "—" : moneyFull.format(entry.average_cost_per_service)}</td>
                      <td>{moneyFull.format(entry.gross_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Evolução mensal dos maiores procedimentos</h3>
          <p>Até cinco séries simultâneas; meses sem consumo do item aparecem como zero dentro da janela.</p>
        </div>
        <ChartCard
          lineageId="procedure-trends.monthly"
          title="Custo mensal por procedimento"
          unit="R$"
          periodLabel={periodLabel}
          chart={
            <LineChart
              series={data.series.slice(0, 5).map((entry, index) => ({
                name: entry.description,
                color: SERIES_PALETTE[index % SERIES_PALETTE.length],
                unit: "R$",
                points: entry.monthly.map((point) => ({ x: point.month, y: point.gross_cost })),
              }))}
              formatValue={(value) => money.format(value)}
              ariaLabel="Custo mensal dos cinco maiores procedimentos"
            />
          }
          legend={<ChartLegend items={data.series.slice(0, 5).map((entry, index) => ({ name: entry.description, color: SERIES_PALETTE[index % SERIES_PALETTE.length] }))} />}
          table={
            <table className={styles.table}>
              <thead><tr><th scope="col">Procedimento</th><th scope="col" className={styles.txt}>Mês</th><th scope="col" className={styles.num}>Serviços</th><th scope="col" className={styles.num}>Custo (R$)</th></tr></thead>
              <tbody>
                {data.series.slice(0, 5).flatMap((entry) =>
                  entry.monthly.map((point) => (
                    <tr key={`${entry.entity_key}-${point.month}`}>
                      <td>{entry.description}</td>
                      <td className={styles.txt}>{point.month}</td>
                      <td className={styles.num}>{point.service_quantity === null ? "—" : number.format(point.service_quantity)}</td>
                      <td className={styles.num}>{point.gross_cost === null ? "—" : moneyFull.format(point.gross_cost)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          }
        />
      </article>
    </div>
  );
}

type RankedRow = ProcedureWindowRow & { growthLabel: string };

function rankRows(data: ProcedureTrendsData, view: RankView): RankedRow[] {
  const growthByKey = new Map(data.growth_ranking.map((entry) => [entry.entity_key, entry]));
  const withGrowth = data.window.map((row) => {
    const growthEntry = growthByKey.get(row.entity_key);
    const growthLabel = !growthEntry
      ? "sem série"
      : growthEntry.growth_state === "new"
        ? "novo no período"
        : growthEntry.growth_state !== "valid" || growthEntry.growth_pct === null
          ? "sem base comparável"
          : `${growthEntry.growth_pct >= 0 ? "↑" : "↓"} ${percent.format(Math.abs(growthEntry.growth_pct))}%`;
    return { ...row, growthLabel, growthPct: growthEntry?.growth_pct ?? null };
  });
  const sorted = [...withGrowth];
  if (view === "most_used") sorted.sort((a, b) => b.service_quantity - a.service_quantity || a.entity_key.localeCompare(b.entity_key));
  if (view === "most_expensive") sorted.sort((a, b) => b.gross_cost - a.gross_cost || a.entity_key.localeCompare(b.entity_key));
  if (view === "highest_avg") sorted.sort((a, b) => (b.average_cost_per_service ?? -1) - (a.average_cost_per_service ?? -1) || a.entity_key.localeCompare(b.entity_key));
  if (view === "growth") sorted.sort((a, b) => (b.growthPct ?? -Infinity) - (a.growthPct ?? -Infinity) || a.entity_key.localeCompare(b.entity_key));
  return sorted.slice(0, 10);
}
