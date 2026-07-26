"use client";

// Três séries temporais da aba Análise Sinistro: por data de atendimento
// (quanto foi ATENDIDO no mês), por competência de cobrança (quanto foi
// FATURADO no mês) e a agregação trimestral, derivada no cliente da série
// mensal por atendimento (ver src/features/claims/quarterly.ts).
//
// A série trimestral é o motivo de existir deste componente: ela expõe
// `utilizantes_media_mensal` — a MÉDIA dos utilizantes mensais do
// trimestre, nunca a soma, porque somar contaria a mesma pessoa em mais de
// um mês. Por ter unidade diferente de sinistro (pessoas/mês vs. R$), ela
// ganha seu próprio mini-gráfico dentro do card, em vez de dividir o eixo Y
// do gráfico de custo — misturar as duas escalas num único eixo deturparia
// os ticks de ambas.

import type { GoldPreview } from "../../../contracts/gold-preview";
import { agruparTrimestres, type Trimestre } from "../quarterly";
import styles from "../ClaimsTab.module.css";
import { ChartCard, ChartLegend, LineChart, SEMANTIC_COLORS, type Series } from "../../sinistralidade/components/charts";

const moedaCompacta = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

// "YYYY-MM" -> "MM/AA", mesma técnica de `monthTick` em charts.tsx, para a
// coluna de mês da tabela acessível ficar legível.
function mesLabel(mes: string): string {
  return `${mes.slice(5)}/${mes.slice(2, 4)}`;
}

export function MonthlySeries({
  mensal,
  competencia,
}: {
  mensal: GoldPreview["mensal"];
  competencia: GoldPreview["competencia"];
}) {
  const trimestres = agruparTrimestres(mensal);

  return (
    <div className={styles.chartStack}>
      <SerieMensalChart mensal={mensal} />
      <SerieCompetenciaChart competencia={competencia} />
      <SerieTrimestralChart trimestres={trimestres} />
    </div>
  );
}

function SerieMensalChart({ mensal }: { mensal: GoldPreview["mensal"] }) {
  const mesesParciais = mensal.filter((linha) => linha.parcial).map((linha) => linha.mes);
  const series: Series[] = [
    { name: "Sinistro", color: SEMANTIC_COLORS.cost, unit: "R$", points: mensal.map((linha) => ({ x: linha.mes, y: linha.sinistro })) },
  ];

  return (
    <ChartCard
      lineageId="claims.monthly"
      title="Sinistro mensal por data de atendimento"
      subtitle="Quanto foi ATENDIDO no mês. Faixa laranja = mês parcial, com faturamento ainda incompleto (lag de cobrança ~2 meses)."
      unit="R$"
      chart={
        <LineChart
          series={series}
          partialMonths={mesesParciais}
          formatValue={(value) => moedaCompacta.format(value)}
          ariaLabel="Sinistro mensal por data de atendimento (R$)"
        />
      }
      legend={<ChartLegend items={series.map((entry) => ({ name: entry.name, color: entry.color }))} />}
      table={<SerieMensalTable mensal={mensal} />}
    />
  );
}

function SerieMensalTable({ mensal }: { mensal: GoldPreview["mensal"] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Mês</th>
          <th scope="col" className={styles.num}>Sinistro (R$)</th>
          <th scope="col" className={styles.num}>Itens</th>
          <th scope="col" className={styles.num}>Utilizantes</th>
          <th scope="col">Situação</th>
        </tr>
      </thead>
      <tbody>
        {mensal.map((linha) => (
          <tr key={linha.mes}>
            <td>{mesLabel(linha.mes)}</td>
            <td className={styles.num}>{moedaCheia.format(linha.sinistro)}</td>
            <td className={styles.num}>{inteiro.format(linha.itens)}</td>
            <td className={styles.num}>{inteiro.format(linha.utilizantes)}</td>
            <td>{linha.parcial ? "Parcial" : "Fechado"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SerieCompetenciaChart({ competencia }: { competencia: GoldPreview["competencia"] }) {
  const series: Series[] = [
    { name: "Sinistro faturado", color: SEMANTIC_COLORS.usage, unit: "R$", points: competencia.map((linha) => ({ x: linha.mes, y: linha.sinistro })) },
  ];

  return (
    <ChartCard
      lineageId="claims.competency"
      title="Sinistro por competência de cobrança"
      subtitle="Quanto foi FATURADO no mês — não quando o serviço ocorreu. Difere da série por atendimento acima pelo lag de cobrança; não é um erro entre as duas."
      unit="R$"
      chart={
        <LineChart
          series={series}
          formatValue={(value) => moedaCompacta.format(value)}
          ariaLabel="Sinistro mensal por competência de cobrança (R$)"
        />
      }
      legend={<ChartLegend items={series.map((entry) => ({ name: entry.name, color: entry.color }))} />}
      table={<SerieCompetenciaTable competencia={competencia} />}
    />
  );
}

function SerieCompetenciaTable({ competencia }: { competencia: GoldPreview["competencia"] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Competência</th>
          <th scope="col" className={styles.num}>Sinistro faturado (R$)</th>
          <th scope="col" className={styles.num}>Serviços</th>
          <th scope="col" className={styles.num}>Linhas</th>
        </tr>
      </thead>
      <tbody>
        {competencia.map((linha) => (
          <tr key={linha.mes}>
            <td>{mesLabel(linha.mes)}</td>
            <td className={styles.num}>{moedaCheia.format(linha.sinistro)}</td>
            <td className={styles.num}>{inteiro.format(linha.servicos)}</td>
            <td className={styles.num}>{inteiro.format(linha.linhas)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SerieTrimestralChart({ trimestres }: { trimestres: Trimestre[] }) {
  const trimestresParciais = trimestres.filter((t) => t.parcial).map((t) => t.trimestre);
  const sinistroSeries: Series[] = [
    { name: "Sinistro", color: SEMANTIC_COLORS.cost, unit: "R$", points: trimestres.map((t) => ({ x: t.trimestre, y: t.sinistro })) },
  ];
  const utilizantesSeries: Series[] = [
    {
      name: "Utilizantes · média mensal",
      color: SEMANTIC_COLORS.usage,
      unit: "pessoas/mês",
      points: trimestres.map((t) => ({ x: t.trimestre, y: t.utilizantes_media_mensal })),
    },
  ];
  const totalParciais = trimestresParciais.length;

  return (
    <ChartCard
      lineageId="claims.quarterly"
      title="Sinistro trimestral"
      subtitle="Agregado no cliente a partir da série mensal por atendimento (não tem consulta própria). Utilizantes é a MÉDIA mensal do trimestre, nunca a soma — somar contaria a mesma pessoa em mais de um mês."
      unit="R$ (sinistro) e pessoas/mês (utilizantes)"
      coverageNote={totalParciais ? `${totalParciais} de ${trimestres.length} trimestre(s) parcial(is) — mês incompleto ou trimestre com menos de três meses` : null}
      chart={
        <div className={styles.quarterlyCharts}>
          <div>
            <p className={styles.quarterlyChartLabel}>Sinistro</p>
            <LineChart
              series={sinistroSeries}
              partialMonths={trimestresParciais}
              formatValue={(value) => moedaCompacta.format(value)}
              ariaLabel="Sinistro trimestral (R$)"
              height={160}
            />
          </div>
          <div>
            <p className={styles.quarterlyChartLabel}>Utilizantes · média mensal (nunca somar entre meses)</p>
            <LineChart
              series={utilizantesSeries}
              partialMonths={trimestresParciais}
              formatValue={(value) => inteiro.format(value)}
              ariaLabel="Utilizantes, média mensal por trimestre (pessoas por mês, não soma)"
              height={160}
            />
          </div>
        </div>
      }
      legend={<ChartLegend items={[...sinistroSeries, ...utilizantesSeries].map((entry) => ({ name: entry.name, color: entry.color }))} />}
      table={<SerieTrimestralTable trimestres={trimestres} />}
    />
  );
}

function SerieTrimestralTable({ trimestres }: { trimestres: Trimestre[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Trimestre</th>
          <th scope="col" className={styles.num}>Sinistro (R$)</th>
          <th scope="col" className={styles.num}>Itens</th>
          <th scope="col" className={styles.num}>Utilizantes (média mensal)</th>
          <th scope="col" className={styles.num}>Meses incluídos</th>
          <th scope="col">Situação</th>
        </tr>
      </thead>
      <tbody>
        {trimestres.map((t) => (
          <tr key={t.trimestre}>
            <td>{t.trimestre}</td>
            <td className={styles.num}>{moedaCheia.format(t.sinistro)}</td>
            <td className={styles.num}>{inteiro.format(t.itens)}</td>
            <td className={styles.num}>{inteiro.format(t.utilizantes_media_mensal)}</td>
            <td className={styles.num}>{t.meses}</td>
            <td>{t.parcial ? "Parcial" : "Completo"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
