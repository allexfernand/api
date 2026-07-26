"use client";

// Cabeçalho da aba Análise Sinistro: identidade da aba, composição da
// carteira, procedência dos dados (fonte gold + versão Delta + geração) e o
// toggle "Análise Databricks" — mesmo padrão de
// features/sinistralidade/components/AnalyticsHeader.tsx. Nenhum valor aqui é
// hardcoded: tudo vem de `fonte`/`carteira` do payload; sem eles, o texto diz
// que falta o dado em vez de inventar um número.
//
// O selo "PREVIEW / MOCK" do fragment antigo não é reproduzido: esta aba
// deixou de ser preview.

import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { useLineage } from "../../sinistralidade/components/LineageProvider";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatadorData = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function resumoCarteira(carteira: GoldPreview["carteira"]): string {
  if (!carteira.empresas.length) return "Carteira indisponível.";
  const empresas = carteira.empresas.length === 1 ? "1 empresa" : `${carteira.empresas.length} empresas`;
  const operadoras = carteira.operadoras.length ? carteira.operadoras.join("/") : "—";
  return `${empresas} · ${formatadorInteiro.format(carteira.beneficiarios_total)} beneficiários · via ${operadoras}`;
}

function detalheCarteira(carteira: GoldPreview["carteira"]): string | undefined {
  if (!carteira.empresas.length) return undefined;
  return carteira.empresas
    .map((empresa) => {
      const share = empresa.share == null ? "" : ` ${formatadorPercentual.format(empresa.share)}%`;
      return `${empresa.nome}${share} (${formatadorInteiro.format(empresa.beneficiarios)} benef.)`;
    })
    .join(" · ");
}

export function ClaimsHeader({
  fonte,
  carteira,
}: {
  fonte: GoldPreview["fonte"];
  carteira: GoldPreview["carteira"];
}) {
  const lineage = useLineage();
  const geradoEm = new Date(fonte.gerado_em);
  const dataValida = !Number.isNaN(geradoEm.getTime());

  return (
    <header className={styles.hero}>
      <div className={styles.heroIdentity}>
        <div className={styles.heroIcon} aria-hidden="true">
          <i className="fa-solid fa-file-invoice-dollar" />
        </div>
        <div>
          <div className={styles.eyebrow}>Sinistralidade</div>
          <div className={styles.heroTitle}>Análise Sinistro</div>
          <div className={styles.heroSub}>
            Fonte {fonte.gold} · Delta v{fonte.delta_version}
            {dataValida ? ` · gerado em ${formatadorData.format(geradoEm)}` : ""}
          </div>
        </div>
      </div>
      <div className={styles.heroBadges}>
        <div className={styles.chipInfo} title={detalheCarteira(carteira)}>
          Carteira: {resumoCarteira(carteira)}
        </div>
      </div>
      {lineage.available ? (
        <div className={styles.lineageToggleRow}>
          <button
            type="button"
            className={`${styles.lineageToggle} ${lineage.enabled ? styles.lineageToggleOn : ""}`}
            aria-pressed={lineage.enabled}
            disabled={lineage.status === "loading"}
            onClick={lineage.toggle}
          >
            <i className="fa-solid fa-diagram-project" aria-hidden="true" />
            <span>{lineage.status === "loading" ? "Carregando linhagem…" : "Análise Databricks"}</span>
          </button>
          {lineage.enabled ? (
            <p className={styles.lineageHint} role="status">
              Modo de análise ligado: clique em um gráfico ou indicador para ver de onde o dado vem. Clique no botão
              novamente para sair.
            </p>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
