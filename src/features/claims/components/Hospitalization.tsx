"use client";

// B5 do fragmento legado (src/dashboard/fragments/gold-preview.html linhas
// 75-117) e public/scripts/gold-preview.js (aplicarDadosReais, blocos
// `int`/`sm`): custo de internação por agrupamento clínico e o painel
// "Saúde mental e internação".
//
// O card de fatos reúne dois blocos de linhagem diferentes porque o
// fragmento original também os reunia num único card
// (id="pg-b5-saude-mental-card"): saúde mental (claims.mental-health) e as
// estatísticas de internação (claims.hospitalization — mesma consulta do
// gráfico de agrupamento acima).
//
// O share de saúde mental é um INTERVALO, não um número único: parte do
// custo tem flag_saude_mental NULL (nem confirmada, nem descartada), então
// share_flag é o piso e share_flag + share_sem_classificacao é o teto
// honesto do custo que PODE ser saúde mental — colapsar isso num só valor
// reivindicaria uma precisão que os dados não têm.

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { ChartCard, ParetoChart } from "../../sinistralidade/components/charts";
import { LineageAnchor } from "../../sinistralidade/components/LineageAnchor";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Valor já vem em milhões (sinistro_mi) — um formatador de moeda compacto
// dividiria a magnitude de novo e mostraria "R$ 6" em vez de "R$ 5,8M".
function formatarMilhoes(valorEmMilhoes: number): string {
  return `R$ ${valorEmMilhoes.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

function formatarDias(dias: number): string {
  const arredondado = Math.round(dias);
  return `${formatadorInteiro.format(arredondado)} ${arredondado === 1 ? "dia" : "dias"}`;
}

function temaLabel(tema: string): string {
  const semUnderscore = tema.replace(/_/g, " ");
  return semUnderscore.charAt(0).toUpperCase() + semUnderscore.slice(1);
}

export function Hospitalization({
  internacao,
  saudeMental,
}: {
  internacao: GoldPreview["internacao"];
  saudeMental: GoldPreview["saude_mental"];
}) {
  const itens = internacao.por_agrupamento.map((linha) => ({
    label: linha.agrupamento,
    value: linha.sinistro_mi,
    // Sem acumulado: o servidor só devolve os agrupamentos de maior custo
    // (top 8), sem um total geral nem um bucket "Outros" somando o resto —
    // calcular um % acumulado com esse denominador incompleto criaria uma
    // precisão que os dados não sustentam.
    cumulativeShare: null,
  }));

  return (
    <div className={styles.chartStack}>
      <ChartCard
        lineageId="claims.hospitalization"
        title="Custo de internação por agrupamento clínico"
        subtitle={`Os ${itens.length} agrupamentos de maior custo de internação desde 2024-01.`}
        unit="R$ milhões"
        chart={
          <ParetoChart
            items={itens}
            formatValue={(value) => formatarMilhoes(value)}
            ariaLabel="Custo de internação por agrupamento clínico, em milhões de reais"
            // showCumulative=false: todo item acima já tem cumulativeShare
            // null (sem total geral nem bucket "Outros" para sustentar um %
            // honesto) — sem isto, o gráfico ainda desenharia o eixo de
            // 0/50/80/100% à direita, sugerindo uma dimensão que os dados
            // não têm por trás dele.
            showCumulative={false}
          />
        }
        table={<HospitalizationTable itens={internacao.por_agrupamento} />}
      />
      <MentalHealthPanel saudeMental={saudeMental} internacao={internacao} />
    </div>
  );
}

function HospitalizationTable({ itens }: { itens: GoldPreview["internacao"]["por_agrupamento"] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col" className={styles.txt}>Agrupamento clínico</th>
          <th scope="col" className={styles.num}>Custo (R$ M)</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((linha) => (
          <tr key={linha.agrupamento}>
            <td className={styles.txt}>{linha.agrupamento}</td>
            <td className={styles.num}>{formatarMilhoes(linha.sinistro_mi)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MentalHealthPanel({
  saudeMental,
  internacao,
}: {
  saudeMental: GoldPreview["saude_mental"];
  internacao: GoldPreview["internacao"];
}) {
  const piso = saudeMental.share_flag;
  const teto = piso !== null && saudeMental.share_sem_classificacao !== null ? piso + saudeMental.share_sem_classificacao : null;
  const intervalo = piso !== null && teto !== null
    ? `${formatadorPercentual.format(piso)}% – ${formatadorPercentual.format(teto)}%`
    : "—";

  return (
    <article className={styles.card}>
      <div className={styles.cardTitle}>
        <h3>Saúde mental e internação</h3>
        <p>Share de saúde mental exibido como intervalo — parte do custo não tem a flag de saúde mental confirmada nem descartada.</p>
      </div>
      <LineageAnchor lineageId="claims.mental-health" label="Saúde mental — share do custo">
        <div className={styles.factList}>
          <div className={styles.factRow}>
            <span>Saúde mental (share do custo)</span>
            <strong>{intervalo}</strong>
          </div>
          <p className={styles.factNote}>
            {saudeMental.share_sem_classificacao === null
              ? "Participação sem classificação indisponível."
              : `${formatadorPercentual.format(saudeMental.share_sem_classificacao)}% do custo está sem classificação — o teto do intervalo é um limite honesto, não uma confirmação de que todo esse custo é saúde mental.`}
          </p>
          {saudeMental.por_tema_mi.length ? (
            <div className={styles.factSubList}>
              {saudeMental.por_tema_mi.map((tema) => (
                <div className={styles.factRow} key={tema.tema}>
                  <span>· {temaLabel(tema.tema)}</span>
                  <strong>{formatarMilhoes(tema.sinistro_mi)}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </LineageAnchor>
      <LineageAnchor lineageId="claims.hospitalization" label="Estatísticas de internação">
        <div className={`${styles.factList} ${styles.factListDivided}`}>
          <div className={styles.factRow}>
            <span>Internações distintas</span>
            <strong>{formatadorInteiro.format(internacao.internacoes_distintas)}</strong>
          </div>
          <div className={styles.factRow}>
            <span>Custo médio por internação</span>
            <strong>{moedaCheia.format(internacao.custo_medio)}</strong>
          </div>
          <div className={styles.factRow}>
            <span>Duração mediana / p90</span>
            <strong>{formatarDias(internacao.duracao_mediana_dias)} / {formatarDias(internacao.duracao_p90_dias)}</strong>
          </div>
        </div>
      </LineageAnchor>
    </article>
  );
}
