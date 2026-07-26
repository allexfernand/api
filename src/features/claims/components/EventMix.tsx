"use client";

// Composição mensal do custo por tipo de evento — B2 do fragmento legado
// (src/dashboard/fragments/gold-preview.html) e public/scripts/gold-preview.js
// (função aplicarDadosReais, bloco `comp`). `composicao_tipo_evento` chega do
// contrato como mapa mês -> tipo de evento -> sinistro
// (Record<string, Record<string, number>>), NÃO uma lista: aqui viramos isso
// na forma que StackedBarChart espera — meses ordenados + até cinco
// segmentos (os tipos de maior sinistro na janela) mais um segmento "Outros"
// agregando o resto, igual à mesma técnica do script legado.

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { ChartCard, ChartLegend, SERIES_PALETTE, StackedBarChart } from "../../sinistralidade/components/charts";

const OUTROS = "Outros";
const MAX_TIPOS = 5;

const moedaCompacta = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// "YYYY-MM" -> "MM/AA", mesma técnica de `monthTick` em charts.tsx.
function mesLabel(mes: string): string {
  return `${mes.slice(5)}/${mes.slice(2, 4)}`;
}

function totalDoMes(porTipo: Record<string, number> | undefined): number {
  return Object.values(porTipo ?? {}).reduce((total, custo) => total + custo, 0);
}

export function EventMix({ data }: { data: GoldPreview["composicao_tipo_evento"] }) {
  const meses = Object.keys(data).sort();

  // Ranking dos tipos pelo total na janela inteira, para decidir quais cinco
  // ganham segmento próprio; o resto entra em "Outros" (mesmo corte do
  // script legado, evitando estourar o limite de séries do gráfico).
  const totalPorTipo = new Map<string, number>();
  for (const mes of meses) {
    for (const [tipo, custo] of Object.entries(data[mes] ?? {})) {
      totalPorTipo.set(tipo, (totalPorTipo.get(tipo) ?? 0) + custo);
    }
  }
  const tiposTop = [...totalPorTipo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TIPOS)
    .map(([tipo]) => tipo);

  const segments = [
    ...tiposTop.map((tipo, index) => ({
      name: tipo,
      color: SERIES_PALETTE[index % SERIES_PALETTE.length],
      // Tipo ausente num mês presente = custo zero naquele tipo, não dado
      // faltante — o mês em si tem registro (outros tipos aparecem nele).
      values: meses.map((mes) => data[mes]?.[tipo] ?? 0),
    })),
    {
      name: OUTROS,
      color: "#d1d5db",
      values: meses.map((mes) =>
        Object.entries(data[mes] ?? {})
          .filter(([tipo]) => !tiposTop.includes(tipo))
          .reduce((total, [, custo]) => total + custo, 0),
      ),
    },
  ];

  return (
    <ChartCard
      lineageId="claims.event-mix"
      title="Composição do custo por tipo de evento"
      subtitle="Sinistro mensal por tipo de evento desde 2025-01. Os cinco maiores tipos da janela ganham série própria; o restante fica em “Outros”."
      unit="R$"
      chart={
        <StackedBarChart
          months={meses}
          segments={segments}
          formatValue={(value) => moedaCompacta.format(value)}
          ariaLabel="Composição mensal do custo por tipo de evento"
        />
      }
      legend={<ChartLegend items={segments.map((segment) => ({ name: segment.name, color: segment.color }))} />}
      table={<EventMixTable meses={meses} data={data} tiposTop={tiposTop} />}
    />
  );
}

function EventMixTable({
  meses,
  data,
  tiposTop,
}: {
  meses: string[];
  data: GoldPreview["composicao_tipo_evento"];
  tiposTop: string[];
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Mês</th>
          <th scope="col" className={styles.txt}>Tipo de evento</th>
          <th scope="col" className={styles.num}>Sinistro (R$)</th>
          <th scope="col" className={styles.num}>Participação no mês</th>
        </tr>
      </thead>
      <tbody>
        {meses.flatMap((mes) => {
          const doMes = data[mes] ?? {};
          const total = totalDoMes(doMes);
          const outrosCusto = Object.entries(doMes)
            .filter(([tipo]) => !tiposTop.includes(tipo))
            .reduce((soma, [, custo]) => soma + custo, 0);
          const linhas = [
            ...tiposTop.map((tipo) => ({ tipo, custo: doMes[tipo] ?? 0 })),
            { tipo: OUTROS, custo: outrosCusto },
          ];
          return linhas.map((linha) => (
            <tr key={`${mes}-${linha.tipo}`}>
              <td>{mesLabel(mes)}</td>
              <td className={styles.txt}>{linha.tipo}</td>
              <td className={styles.num}>{moedaCheia.format(linha.custo)}</td>
              <td className={styles.num}>{total ? `${formatadorPercentual.format((100 * linha.custo) / total)}%` : "—"}</td>
            </tr>
          ));
        })}
      </tbody>
    </table>
  );
}
