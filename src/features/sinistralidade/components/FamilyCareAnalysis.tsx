"use client";

// Família antes/depois (linha do tempo relativa à entrada) e
// fatura × coordenação por mês.

import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, LineChart, SEMANTIC_COLORS } from "./charts";
import type { CareTimelineData, FamilyTimelineData } from "../types";
import { money, moneyFull, monthLabel, number } from "../types";

export function FamilyTimelineBlock({ data }: { data: FamilyTimelineData }) {
  const points = data.relative_months;
  return (
    <article className={styles.card}>
      <div className={styles.cardTitle}>
        <h3>Família: antes e depois da entrada</h3>
        <p>Custo por mês relativo à entrada do grupo familiar (coortes agregadas). Entrada derivada do snapshot atual.</p>
      </div>
      <ChartCard
        title="Custo por mês relativo"
        unit="R$"
        periodLabel="mês -12 a +12 da entrada"
        chart={
          <LineChart
            series={[{
              name: "Custo",
              color: SEMANTIC_COLORS.families,
              unit: "R$",
              points: points.map((entry) => ({ x: String(entry.relative_month), y: entry.gross_cost })),
            }]}
            formatValue={(value) => money.format(value)}
            ariaLabel="Custo agregado por mês relativo à entrada familiar"
          />
        }
        legend={<ChartLegend items={[{ name: "Custo por mês relativo", color: SEMANTIC_COLORS.families }]} />}
        table={
          <table className={styles.table}>
            <thead>
              <tr><th scope="col">Mês relativo</th><th scope="col" className={styles.num}>Famílias</th><th scope="col" className={styles.num}>Serviços</th><th scope="col" className={styles.num}>Internações</th><th scope="col" className={styles.txt}>Evento principal</th><th scope="col" className={styles.num}>Custo (R$)</th></tr>
            </thead>
            <tbody>
              {points.map((entry) => (
                <tr key={entry.relative_month}>
                  <td>{entry.relative_month >= 0 ? `+${entry.relative_month}` : entry.relative_month}</td>
                  <td className={styles.num}>{number.format(entry.families)}</td>
                  <td className={styles.num}>{number.format(entry.service_quantity)}</td>
                  <td className={styles.num}>{number.format(entry.hospitalization_episodes)}</td>
                  <td className={styles.txt}>{entry.primary_event}</td>
                  <td className={styles.num}>{moneyFull.format(entry.gross_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
      <p className={styles.methodNote}>
        Dependentes sem ponte familiar confiável não entram nesta análise; a associação não é inferida.
      </p>
    </article>
  );
}

export function CareTimelineBlock({ data, periodLabel }: { data: CareTimelineData; periodLabel: string }) {
  const months = [...new Set(data.monthly.map((entry) => entry.month))].sort();
  const cell = (month: string, used: boolean, coordinated: boolean) =>
    data.monthly.find((entry) => entry.month === month && entry.used_plan === used && entry.had_care_coordination === coordinated);

  return (
    <article className={styles.card}>
      <div className={styles.cardTitle}>
        <h3>Fatura × coordenação por mês</h3>
        <p>Quadrantes: usa e é coordenado, usa sem coordenação, não usa e é coordenado, sem alcance. Período: {periodLabel}.</p>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Mês</th>
              <th scope="col" className={styles.num}>Uso acompanhado</th>
              <th scope="col" className={styles.num}>Uso sem coordenação</th>
              <th scope="col" className={styles.num}>Prevenção ativa</th>
              <th scope="col" className={styles.num}>Sem alcance</th>
              <th scope="col" className={styles.num}>Sem ponte familiar</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => {
              const bridgeless = data.monthly.filter((entry) => entry.month === month).reduce((total, entry) => total + entry.people_without_family_bridge, 0);
              return (
                <tr key={month}>
                  <td>{monthLabel(month)}</td>
                  <td className={styles.num}>{formatPeople(cell(month, true, true)?.people)}</td>
                  <td className={`${styles.negative} ${styles.num}`}>{formatPeople(cell(month, true, false)?.people)}</td>
                  <td className={styles.num}>{formatPeople(cell(month, false, true)?.people)}</td>
                  <td className={styles.num}>{formatPeople(cell(month, false, false)?.people)}</td>
                  <td className={styles.num}>{number.format(bridgeless)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.methodNote}>
        Contagens pequenas podem aparecer suprimidas (—) para perfis externos. Unidade: pessoas elegíveis no mês.
      </p>
      <DemographicGaps rows={data.demographics} />
    </article>
  );
}

const DIMENSION_LABELS: Record<string, string> = {
  sexo: "Sexo",
  vinculo: "Vínculo",
  estado: "Estado",
};

// Gaps demográficos da janela: onde estão as pessoas que usam o plano sem
// coordenação, por sexo, vínculo e estado. Pessoa distinta na janela.
function DemographicGaps({ rows }: { rows: CareTimelineData["demographics"] }) {
  if (!rows.length) return null;
  const dimensions = [...new Set(rows.map((row) => row.dimension))];
  return (
    <div className={styles.blockStack}>
      <div className={styles.cardTitle}>
        <h3>Gaps demográficos do período</h3>
        <p>Pessoas que utilizaram o plano sem coordenação, por recorte permitido. Prioridade = maior gap.</p>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Recorte</th>
              <th scope="col">Valor</th>
              <th scope="col" className={styles.num}>Utilizantes</th>
              <th scope="col" className={styles.num}>Uso sem coordenação</th>
              <th scope="col" className={styles.num}>% do gap</th>
              <th scope="col" className={styles.num}>Custo do gap (R$)</th>
            </tr>
          </thead>
          <tbody>
            {dimensions.flatMap((dimension) => {
              const values = [...new Set(rows.filter((row) => row.dimension === dimension).map((row) => row.value))];
              return values
                .map((value) => {
                  const cells = rows.filter((row) => row.dimension === dimension && row.value === value);
                  const sum = (predicate: (row: (typeof cells)[number]) => boolean) => {
                    const selected = cells.filter(predicate);
                    if (selected.some((row) => row.people === null)) return null;
                    return selected.reduce((total, row) => total + (row.people ?? 0), 0);
                  };
                  const utilizers = sum((row) => row.used_plan);
                  const gapPeople = sum((row) => row.used_plan && !row.had_care_coordination);
                  const gapCost = cells
                    .filter((row) => row.used_plan && !row.had_care_coordination)
                    .reduce((total, row) => total + row.gross_cost, 0);
                  return { dimension, value, utilizers, gapPeople, gapCost };
                })
                .sort((a, b) => (b.gapPeople ?? -1) - (a.gapPeople ?? -1))
                .slice(0, 6)
                .map((entry) => (
                  <tr key={`${entry.dimension}-${entry.value}`}>
                    <td>{DIMENSION_LABELS[entry.dimension] ?? entry.dimension}</td>
                    <td><strong>{entry.value}</strong></td>
                    <td className={styles.num}>{entry.utilizers === null ? "—" : number.format(entry.utilizers)}</td>
                    <td className={`${styles.negative} ${styles.num}`}>{entry.gapPeople === null ? "—" : number.format(entry.gapPeople)}</td>
                    <td className={styles.num}>
                      {entry.gapPeople === null || entry.utilizers === null || !entry.utilizers
                        ? "—"
                        : `${number.format((entry.gapPeople / entry.utilizers) * 100)}%`}
                    </td>
                    <td className={styles.num}>{moneyFull.format(entry.gapCost)}</td>
                  </tr>
                ));
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.methodNote}>
        Pessoa distinta dentro da janela; grupos pequenos suprimidos para perfis externos entram como “—”.
      </p>
    </div>
  );
}

function formatPeople(value: number | null | undefined) {
  if (value === undefined) return "0";
  if (value === null) return "—";
  return number.format(value);
}
