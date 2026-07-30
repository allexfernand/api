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
import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { ChartCard, ParetoChart } from "../../sinistralidade/components/charts";
import { LineageAnchor } from "../../sinistralidade/components/LineageAnchor";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moedaCompacta = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

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

function percentual(valor: number | null): string {
  return valor === null ? "—" : `${formatadorPercentual.format(valor)}%`;
}

function MetricTile({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className={styles.statTile}>
      <p className={styles.statLabel}>{label}</p>
      <div className={styles.flowRow}>{value}</div>
      {helper ? <p className={styles.statHelper}>{helper}</p> : null}
    </div>
  );
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
        title="Custo de internação por acomodação"
        subtitle={`As ${itens.length} acomodações de maior custo de internação desde 2024-01.`}
        unit="R$ milhões"
        chart={
          <ParetoChart
            items={itens}
            formatValue={(value) => formatarMilhoes(value)}
            ariaLabel="Custo de internação por acomodação, em milhões de reais"
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
          <th scope="col" className={styles.txt}>Acomodação</th>
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
  const internacaoMental = internacao.por_saude_mental.find((linha) => linha.saude_mental);
  const internacaoDemais = internacao.por_saude_mental.find((linha) => !linha.saude_mental);
  const metricasInternacao = [
    { label: "Episódios contínuos", mental: internacaoMental ? formatadorInteiro.format(internacaoMental.episodios) : "—", demais: internacaoDemais ? formatadorInteiro.format(internacaoDemais.episodios) : "—" },
    { label: "Beneficiários", mental: internacaoMental ? formatadorInteiro.format(internacaoMental.beneficiarios) : "—", demais: internacaoDemais ? formatadorInteiro.format(internacaoDemais.beneficiarios) : "—" },
    { label: "Custo total", mental: internacaoMental ? moedaCompacta.format(internacaoMental.custo) : "—", demais: internacaoDemais ? moedaCompacta.format(internacaoDemais.custo) : "—" },
    { label: "Custo médio por episódio", mental: internacaoMental ? moedaCheia.format(internacaoMental.custo_medio) : "—", demais: internacaoDemais ? moedaCheia.format(internacaoDemais.custo_medio) : "—" },
    { label: "Duração mediana / p90", mental: internacaoMental ? `${formatarDias(internacaoMental.duracao_mediana_dias)} / ${formatarDias(internacaoMental.duracao_p90_dias)}` : "—", demais: internacaoDemais ? `${formatarDias(internacaoDemais.duracao_mediana_dias)} / ${formatarDias(internacaoDemais.duracao_p90_dias)}` : "—" },
    { label: "Reembolso", mental: internacaoMental ? `${moedaCompacta.format(internacaoMental.reembolso_custo)} · ${percentual(internacaoMental.custo ? 100 * internacaoMental.reembolso_custo / internacaoMental.custo : null)}` : "—", demais: internacaoDemais ? `${moedaCompacta.format(internacaoDemais.reembolso_custo)} · ${percentual(internacaoDemais.custo ? 100 * internacaoDemais.reembolso_custo / internacaoDemais.custo : null)}` : "—" },
    { label: "Cobertura de duração", mental: internacaoMental ? percentual(100 * internacaoMental.cobertura_duracao) : "—", demais: internacaoDemais ? percentual(100 * internacaoDemais.cobertura_duracao) : "—" },
  ];

  return (
    <article className={styles.card}>
      <div className={styles.cardTitle}>
        <h3>Saúde mental e internação</h3>
        <p>Visão agregada desde jan/2024. Saúde mental é classificada por critérios determinísticos e códigos nativos; não exibe diagnóstico.</p>
      </div>
      <LineageAnchor lineageId="claims.mental-health" label="Saúde mental — share do custo">
        <div className={styles.statGrid}>
          <MetricTile label="Custo em saúde mental" value={moedaCompacta.format(saudeMental.custo)} helper={`${percentual(saudeMental.share_flag)} do sinistro`} />
          <MetricTile label="Beneficiários" value={formatadorInteiro.format(saudeMental.beneficiarios)} helper="com uso sinalizado" />
          <MetricTile label="Serviços" value={formatadorInteiro.format(saudeMental.servicos)} helper="quantidade assistencial" />
          <MetricTile label="Reembolso" value={moedaCompacta.format(saudeMental.reembolso_custo)} helper={`${percentual(saudeMental.reembolso_share)} do custo em saúde mental`} />
        </div>
        {saudeMental.por_tema.length ? (
          <table className={`${styles.table} ${styles.tableSmall}`}>
            <thead>
              <tr>
                <th scope="col" className={styles.txt}>Tema</th>
                <th scope="col" className={styles.num}>Custo</th>
                <th scope="col" className={styles.num}>Participação</th>
                <th scope="col" className={styles.num}>Beneficiários</th>
                <th scope="col" className={styles.num}>Serviços</th>
              </tr>
            </thead>
            <tbody>
              {saudeMental.por_tema.map((tema) => (
                <tr key={tema.tema}>
                  <td className={styles.txt}>{temaLabel(tema.tema)}</td>
                  <td className={styles.num}>{moedaCompacta.format(tema.custo)}</td>
                  <td className={styles.num}>{percentual(tema.share)}</td>
                  <td className={styles.num}>{formatadorInteiro.format(tema.beneficiarios)}</td>
                  <td className={styles.num}>{formatadorInteiro.format(tema.servicos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className={styles.factNote}>Não há temas de saúde mental para os filtros aplicados.</p>}
      </LineageAnchor>
      <LineageAnchor lineageId="claims.hospitalization" label="Estatísticas de internação">
        <div className={`${styles.factList} ${styles.factListDivided}`}>
          <p className={styles.insightLabel}>Internações — sinal de saúde mental versus demais</p>
          <p className={styles.factNote}>{formatadorInteiro.format(internacao.linhas_assistenciais)} linhas assistenciais, {formatadorInteiro.format(internacao.internacoes_distintas)} episódios contínuos, {formatadorInteiro.format(internacao.beneficiarios_unicos)} beneficiários e {formatadorInteiro.format(internacao.dias_internados)} dias internados no total.</p>
          <table className={`${styles.table} ${styles.tableSmall}`}>
            <thead>
              <tr>
                <th scope="col" className={styles.txt}>Métrica</th>
                <th scope="col" className={styles.num}>Com sinal</th>
                <th scope="col" className={styles.num}>Demais</th>
              </tr>
            </thead>
            <tbody>
              {metricasInternacao.map((metrica) => (
                <tr key={metrica.label}>
                  <td className={styles.txt}>{metrica.label}</td>
                  <td className={styles.num}>{metrica.mental}</td>
                  <td className={styles.num}>{metrica.demais}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LineageAnchor>
    </article>
  );
}
