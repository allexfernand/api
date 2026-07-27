"use client";

// Sinistro por lotação — B3 do fragmento legado. Gráfico de Pareto: barras
// são o sinistro de cada lotação (as 12 maiores; o servidor já corta, aqui só
// reordenamos por garantia), linha é a participação acumulada.
//
// "Sem lotação" ganha cor própria na barra (SEMANTIC_COLORS.partial, o mesmo
// âmbar do fragmento legado) e uma nota logo abaixo do gráfico — não porque o
// cálculo esteja errado, mas porque o dado falta no CADASTRO DE ORIGEM
// (RH/operadora). É assunto para levar à operadora, não bug de dashboard.

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { ChartCard, ParetoChart, SEMANTIC_COLORS } from "../../sinistralidade/components/charts";

const SEM_LOTACAO = "Sem lotação";

const moedaCompacta = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Função solta (não-componente) de propósito: o corpo precisa de um
// acumulador mutável para o cumulativeShare, e o lint de render (React
// Compiler) proíbe reatribuir variáveis dentro do corpo de um componente.
// ParetoChart espera cumulativeShare como FRAÇÃO (0–1); o payload traz share
// em pontos percentuais (0–100 — ver contracts/gold-preview.ts e a consulta
// em server/routes/gold-preview.ts, que já multiplica por 100). Share nulo
// interrompe o acumulado a partir daquele ponto: sem o valor daquela linha,
// não há como afirmar o acumulado das linhas seguintes.
function paretoItems(ordenadas: GoldPreview["lotacoes"]) {
  let acumuladoPct: number | null = 0;
  return ordenadas.map((linha) => {
    if (linha.share === null || acumuladoPct === null) acumuladoPct = null;
    else acumuladoPct += linha.share;
    return {
      label: linha.lotacao,
      value: linha.sinistro,
      cumulativeShare: acumuladoPct === null ? null : acumuladoPct / 100,
    };
  });
}

export function Locations({ lotacoes }: { lotacoes: GoldPreview["lotacoes"] }) {
  const ordenadas = [...lotacoes].sort((a, b) => b.sinistro - a.sinistro);
  const items = paretoItems(ordenadas);
  const semLotacao = lotacoes.find((linha) => linha.lotacao === SEM_LOTACAO);

  return (
    <div className={styles.chartStack}>
      <ChartCard
        lineageId="claims.locations"
        title="Sinistro por lotação"
        subtitle={`As ${ordenadas.length} lotações de maior sinistro desde 2024-01. Barra destacada = “Sem lotação”.`}
        unit="R$ e % acumulado"
        chart={
          <ParetoChart
            items={items}
            formatValue={(value) => moedaCompacta.format(value)}
            ariaLabel="Sinistro por lotação, com participação acumulada"
            barColor={(item) => (item.label === SEM_LOTACAO ? SEMANTIC_COLORS.partial : SEMANTIC_COLORS.cost)}
          />
        }
        table={<LocationsTable lotacoes={ordenadas} />}
      />
      {semLotacao ? (
        <p className={styles.note} role="note">
          <strong>“Sem lotação”</strong>
          {": "}
          {semLotacao.share === null ? "participação indisponível" : `${formatadorPercentual.format(semLotacao.share)}% do sinistro`}
          {" · "}
          {formatadorInteiro.format(semLotacao.beneficiarios)} beneficiários — o dado falta no cadastro NA ORIGEM, não é um erro de cálculo aqui. Assunto para levar à operadora.
        </p>
      ) : null}
    </div>
  );
}

function LocationsTable({ lotacoes }: { lotacoes: GoldPreview["lotacoes"] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col" className={styles.txt}>Lotação</th>
          <th scope="col" className={styles.num}>Sinistro (R$)</th>
          <th scope="col" className={styles.num}>Beneficiários</th>
          <th scope="col" className={styles.num}>Share</th>
        </tr>
      </thead>
      <tbody>
        {lotacoes.map((linha) => (
          <tr key={linha.lotacao} className={linha.lotacao === SEM_LOTACAO ? styles.semLotacaoRow : undefined}>
            <td className={styles.txt}>{linha.lotacao}</td>
            <td className={styles.num}>{moedaCheia.format(linha.sinistro)}</td>
            <td className={styles.num}>{formatadorInteiro.format(linha.beneficiarios)}</td>
            <td className={styles.num}>{linha.share === null ? "—" : `${formatadorPercentual.format(linha.share)}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
