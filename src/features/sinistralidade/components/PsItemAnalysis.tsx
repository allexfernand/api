"use client";

// Itens associados a episódios de pronto-socorro ao longo do tempo.
// Associação explícita ao episode_key com PS observado; a soma de episódios
// por item não representa episódios únicos globais.

import styles from "../SinistralidadeV2Tab.module.css";
import { ChartCard, ChartLegend, LineChart, SEMANTIC_COLORS } from "./charts";
import type { PsTrendsData } from "../types";
import { money, moneyFull, monthLabel, number } from "../types";

export function PsItemAnalysis({ data, periodLabel }: { data: PsTrendsData; periodLabel: string }) {
  return (
    <div className={styles.twoColumns}>
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Custo e episódios de PS por mês</h3>
          <p>Itens vinculados ao episódio canônico de pronto-socorro.</p>
        </div>
        <ChartCard
          title="Pronto-socorro mensal"
          unit="R$ e episódios"
          periodLabel={periodLabel}
          chart={
            <LineChart
              series={[
                {
                  name: "Custo dos itens (R$)",
                  color: SEMANTIC_COLORS.cost,
                  unit: "R$",
                  points: data.monthly.map((entry) => ({ x: entry.month, y: entry.gross_cost })),
                },
              ]}
              formatValue={(value) => money.format(value)}
              ariaLabel="Custo mensal dos itens de pronto-socorro"
            />
          }
          legend={<ChartLegend items={[{ name: "Custo dos itens", color: SEMANTIC_COLORS.cost }]} />}
          table={
            <table className={styles.table}>
              <thead><tr><th scope="col">Mês</th><th scope="col" className={styles.num}>Episódios de PS</th><th scope="col" className={styles.num}>Serviços</th><th scope="col" className={styles.num}>Custo (R$)</th></tr></thead>
              <tbody>
                {data.monthly.map((entry) => (
                  <tr key={entry.month}>
                    <td>{monthLabel(entry.month)}</td>
                    <td className={styles.num}>{entry.ps_episodes === null ? "—" : number.format(entry.ps_episodes)}</td>
                    <td className={styles.num}>{number.format(entry.service_quantity)}</td>
                    <td className={styles.num}>{moneyFull.format(entry.gross_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </article>
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Itens mais relevantes</h3>
          <p>Medicamentos, exames e materiais dentro dos episódios de PS.</p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Grupo</th>
                <th scope="col" className={styles.num}>Qtde/episódio</th>
                <th scope="col" className={styles.num}>Serviços</th>
                <th scope="col" className={styles.num}>Custo (R$)</th>
              </tr>
            </thead>
            <tbody>
              {data.top_items.map((item) => (
                <tr key={item.entity_key}>
                  <td><strong>{item.description}</strong></td>
                  <td>{item.macrogroup}</td>
                  <td className={styles.num}>{item.quantity_per_episode === null ? "—" : number.format(item.quantity_per_episode)}</td>
                  <td className={styles.num}>{number.format(item.service_quantity)}</td>
                  <td className={styles.num}>{moneyFull.format(item.gross_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.methodNote}>Um episódio pode conter vários itens; somas por item não representam episódios únicos.</p>
      </article>
    </div>
  );
}
