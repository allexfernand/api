"use client";

// Evolução mensal com seletor de métrica, MoM/YoY, média móvel de 3 meses e
// marcação visual de meses parciais/desconhecidos. Meses sem cobertura
// aparecem sem valor (nunca zero).

import { useState } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, LineChart, SEMANTIC_COLORS } from "./charts";
import type { TimelineData, TimelineMonth } from "../types";
import { money, moneyFull, monthLabel, number, percent } from "../types";

type MetricKey = "gross_cost" | "utilizers" | "service_quantity" | "hospitalization_episodes" | "utilizing_families" | "cost_per_utilizer";

const METRICS: { key: MetricKey; label: string; unit: string; color: string; isMoney: boolean }[] = [
  { key: "gross_cost", label: "Custo", unit: "R$", color: SEMANTIC_COLORS.cost, isMoney: true },
  { key: "utilizers", label: "Utilizantes", unit: "pessoas", color: SEMANTIC_COLORS.usage, isMoney: false },
  { key: "service_quantity", label: "Serviços", unit: "serviços", color: SEMANTIC_COLORS.usage, isMoney: false },
  { key: "hospitalization_episodes", label: "Internações", unit: "episódios", color: SEMANTIC_COLORS.hospitalization, isMoney: false },
  { key: "utilizing_families", label: "Famílias", unit: "famílias", color: SEMANTIC_COLORS.families, isMoney: false },
  { key: "cost_per_utilizer", label: "Custo por utilizante", unit: "R$/pessoa", color: SEMANTIC_COLORS.cost, isMoney: true },
];

export function MonthlyEvolutionChart({ data, periodLabel }: { data: TimelineData; periodLabel: string }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("gross_cost");
  const metric = METRICS.find((entry) => entry.key === metricKey)!;
  const months = data.months;
  const partialMonths = months.filter((entry) => entry.status !== "closed").map((entry) => entry.month);
  const format = (value: number) => (metric.isMoney ? money.format(value) : number.format(value));

  const series = [
    {
      name: metric.label,
      color: metric.color,
      unit: metric.unit,
      points: months.map((entry) => ({ x: entry.month, y: entry[metric.key] })),
    },
    ...(metricKey === "gross_cost"
      ? [{
          name: "Média móvel (3m)",
          color: SEMANTIC_COLORS.neutral,
          unit: "R$",
          points: months.map((entry) => ({ x: entry.month, y: entry.moving_average_cost })),
        }]
      : []),
  ];

  return (
    <article className={styles.card}>
      <div className={styles.cardHeaderRow}>
        <div className={styles.cardTitle}>
          <h3>Evolução mensal</h3>
          <p>Meses parciais ou sem gate aparecem com faixa âmbar; meses sem cobertura ficam sem valor.</p>
        </div>
        <div className={styles.metricPicker} role="tablist" aria-label="Métrica da evolução">
          {METRICS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={entry.key === metricKey}
              className={entry.key === metricKey ? styles.metricActive : undefined}
              onClick={() => setMetricKey(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <ChartCard
        title={metric.label}
        unit={metric.unit}
        periodLabel={periodLabel}
        chart={
          <LineChart
            series={series}
            partialMonths={partialMonths}
            formatValue={format}
            ariaLabel={`Evolução mensal de ${metric.label.toLowerCase()} (${metric.unit})`}
          />
        }
        legend={<ChartLegend items={series.map((entry) => ({ name: entry.name, color: entry.color }))} />}
        table={<EvolutionTable months={months} />}
      />
    </article>
  );
}

function EvolutionTable({ months }: { months: TimelineMonth[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Mês</th>
          <th scope="col">Status</th>
          <th scope="col" className={styles.num}>Custo (R$)</th>
          <th scope="col" className={styles.num}>Variação M/M</th>
          <th scope="col" className={styles.num}>Variação A/A</th>
          <th scope="col" className={styles.num}>Utilizantes</th>
          <th scope="col" className={styles.num}>Serviços</th>
          <th scope="col" className={styles.num}>Internações</th>
          <th scope="col" className={styles.num}>Famílias</th>
        </tr>
      </thead>
      <tbody>
        {months.map((entry) => (
          <tr key={entry.month}>
            <td>{monthLabel(entry.month)}</td>
            <td>{entry.status === "closed" ? "Fechado" : entry.status === "partial" ? "Parcial" : "Sem gate"}{entry.has_data ? "" : " · sem cobertura"}</td>
            <td className={styles.num}>{entry.gross_cost === null ? "—" : moneyFull.format(entry.gross_cost)}</td>
            <td className={styles.num}><GrowthCell growth={entry.mom} /></td>
            <td className={styles.num}><GrowthCell growth={entry.yoy} /></td>
            <td className={styles.num}>{entry.utilizers === null ? "—" : number.format(entry.utilizers)}</td>
            <td className={styles.num}>{entry.service_quantity === null ? "—" : number.format(entry.service_quantity)}</td>
            <td className={styles.num}>{entry.hospitalization_episodes === null ? "—" : number.format(entry.hospitalization_episodes)}</td>
            <td className={styles.num}>{entry.utilizing_families === null ? "—" : number.format(entry.utilizing_families)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GrowthCell({ growth }: { growth: { state: string; pct: number | null } }) {
  if (growth.state === "new") return <span>novo</span>;
  if (growth.state !== "valid" || growth.pct === null) return <span>sem base</span>;
  return (
    <span className={growth.pct <= 0 ? styles.positive : styles.negative}>
      {growth.pct >= 0 ? "↑" : "↓"} {percent.format(Math.abs(growth.pct))}%
    </span>
  );
}
