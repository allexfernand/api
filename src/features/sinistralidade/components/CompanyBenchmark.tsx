"use client";

// Comparação entre empresas: absolutos e normalizados lado a lado. Nunca
// ranqueia por custo por vida quando algum denominador é inválido.

import styles from "../SinistralidadeV2Tab.module.css";
import type { BenchmarkData } from "../types";
import { moneyFull, number, percent } from "../types";

export function CompanyBenchmark({ data }: { data: BenchmarkData }) {
  const anyInvalidDenominator = data.companies.some((company) => company.normalized_state !== "valid");
  return (
    <article className={styles.card}>
      <div className={styles.cardTitle}>
        <h3>Comparação entre empresas</h3>
        <p>Somente empresas do seu escopo de acesso. Valores absolutos e normalizados lado a lado.</p>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col" className={styles.num}>Meses</th>
              <th scope="col" className={styles.num}>Custo (R$)</th>
              <th scope="col" className={styles.num}>Participação</th>
              <th scope="col" className={styles.num}>Custo por utilizante</th>
              <th scope="col" className={styles.num}>Serviços por utilizante</th>
              <th scope="col" className={styles.num}>Custo por vida elegível</th>
            </tr>
          </thead>
          <tbody>
            {data.companies.map((company) => (
              <tr key={company.company_key}>
                <td><strong>{company.name}</strong></td>
                <td className={styles.num}>{company.months_observed}</td>
                <td className={styles.num}>{moneyFull.format(company.gross_cost)}</td>
                <td className={styles.num}>{company.operator_cost_share === null ? "—" : `${percent.format(company.operator_cost_share * 100)}%`}</td>
                <td className={styles.num}>{company.cost_per_utilizer === null ? "—" : moneyFull.format(company.cost_per_utilizer)}</td>
                <td className={styles.num}>{company.services_per_utilizer === null ? "—" : number.format(company.services_per_utilizer)}</td>
                <td className={styles.num}>
                  {company.normalized_state === "valid" && company.cost_per_eligible_life !== null
                    ? moneyFull.format(company.cost_per_eligible_life)
                    : "denominador inválido"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyInvalidDenominator ? (
        <p className={styles.methodNote}>
          Empresas sem snapshot de elegibilidade contemporâneo em todos os meses aparecem com denominador inválido e não são ranqueadas por custo por vida.
        </p>
      ) : null}
    </article>
  );
}
