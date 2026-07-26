"use client";

// Dois painéis lado a lado do bloco B4 do fragmento legado: concentração do
// custo nos maiores beneficiários e Top prestadores. Nenhum dos dois tinha
// gráfico no fragmento original (só tiles/tabela), por isso não usam
// ChartCard aqui — só LineageAnchor, para manter o mesmo modo "Análise
// Databricks" dos outros blocos.
//
// Concentração é só agregados: nenhuma identificação individual sai deste
// bloco. A lista nominal, quando autorizada, vive num bloco separado e
// permission-gated em outro lugar da aba (top_utilizantes / B4+ no
// fragmento) — não aqui.
//
// ARMADILHA (ver a nota de linhagem de claims.concentration): apesar do
// nome, `top1_pessoas` NÃO é "a pessoa número um" — é o TAMANHO do grupo
// Top 1% (CEIL(1% dos utilizantes da janela)). Rotulado como tal nos dois
// lugares onde aparece abaixo.

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { LineageAnchor } from "../../sinistralidade/components/LineageAnchor";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// "YYYY-MM" -> "MM/AA", mesma técnica de `monthTick` em charts.tsx.
function mesCurto(mes: string): string {
  return `${mes.slice(5)}/${mes.slice(2, 4)}`;
}

function janelaLabel(janela: string[]): string {
  if (!janela.length) return "janela indisponível";
  const inicio = janela[0];
  const fim = janela[janela.length - 1];
  return inicio === fim ? mesCurto(inicio) : `${mesCurto(inicio)}–${mesCurto(fim)}`;
}

export function Concentration({
  concentracao,
  prestadores,
}: {
  concentracao: GoldPreview["concentracao"];
  prestadores: GoldPreview["prestadores"];
}) {
  return (
    <div className={styles.twoColumns}>
      <ConcentrationPanel concentracao={concentracao} />
      <ProvidersPanel prestadores={prestadores} />
    </div>
  );
}

function ConcentrationPanel({ concentracao }: { concentracao: GoldPreview["concentracao"] }) {
  return (
    <LineageAnchor lineageId="claims.concentration" label="Concentração em beneficiários">
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Concentração em beneficiários</h3>
          <p>
            Só agregados — nenhuma identificação individual sai deste bloco · {formatadorInteiro.format(concentracao.utilizantes)} utilizantes na janela ({janelaLabel(concentracao.janela)})
          </p>
        </div>
        <div className={styles.tileRow}>
          <div className={styles.tile}>
            <div className={styles.tileLabel}>Top 1% ({formatadorInteiro.format(concentracao.top1_pessoas)} pessoas)</div>
            <div className={styles.tileValue}>{formatadorPercentual.format(concentracao.top1_share)}%</div>
            <div className={styles.tileHelper}>do sinistro total da janela</div>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileLabel}>Top 5%</div>
            <div className={styles.tileValue}>{formatadorPercentual.format(concentracao.top5_share)}%</div>
            <div className={styles.tileHelper}>do sinistro total da janela</div>
          </div>
        </div>
        <p className={styles.panelFooter}>
          {formatadorInteiro.format(concentracao.top1_pessoas)} é o TAMANHO do grupo Top 1% (1% dos utilizantes da janela, arredondado para cima) — não é uma pessoa isolada. Argumento de gestão de casos: um grupo pequeno e endereçável concentra boa parte do custo.
        </p>
      </article>
    </LineageAnchor>
  );
}

// Função solta (não-componente) de propósito: precisa de um acumulador
// mutável e o lint de render (React Compiler) proíbe reatribuir variáveis
// dentro do corpo de um componente. Mesma regra de propagação de nulo do
// acumulado de Locations: share ausente numa linha torna o acumulado das
// linhas seguintes indeterminado.
function acumulados(top: GoldPreview["prestadores"]["top"]) {
  let acumulado: number | null = 0;
  return top.map((linha) => {
    if (linha.share === null || acumulado === null) acumulado = null;
    else acumulado += linha.share;
    return { ...linha, acumulado };
  });
}

function ProvidersPanel({ prestadores }: { prestadores: GoldPreview["prestadores"] }) {
  const top = acumulados(prestadores.top);
  const somaSinistroTop = top.reduce((total, linha) => total + linha.sinistro, 0);
  const shareTop = prestadores.sinistro_total ? (100 * somaSinistroTop) / prestadores.sinistro_total : null;

  return (
    <LineageAnchor lineageId="claims.providers" label="Top prestadores">
      <article className={styles.card}>
        <div className={styles.cardTitle}>
          <h3>Top prestadores</h3>
          <p>
            Rede pulverizada: os {top.length} prestadores de maior sinistro desde 2024-01, entre {formatadorInteiro.format(prestadores.total_prestadores)} prestadores no total.
          </p>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.txt}>Prestador</th>
              <th scope="col" className={styles.num}>Sinistro (R$)</th>
              <th scope="col" className={styles.num}>Share</th>
              <th scope="col" className={styles.num}>Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {top.map((linha) => (
              <tr key={linha.prestador}>
                <td className={styles.txt}>{linha.prestador}</td>
                <td className={styles.num}>{moedaCheia.format(linha.sinistro)}</td>
                <td className={styles.num}>{linha.share === null ? "—" : `${formatadorPercentual.format(linha.share)}%`}</td>
                <td className={styles.num}>{linha.acumulado === null ? "—" : `${formatadorPercentual.format(linha.acumulado)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.panelFooter}>
          Top {top.length} juntos = <strong>{shareTop === null ? "—" : `${formatadorPercentual.format(shareTop)}%`}</strong> ({formatadorInteiro.format(prestadores.total_prestadores)} prestadores) — a alavanca está em categorias e pessoas, não num único player.
        </p>
      </article>
    </LineageAnchor>
  );
}
