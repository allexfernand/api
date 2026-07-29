"use client";

// Monta a aba Análise Sinistro: cabeçalho, painel de facetas e os blocos de
// conteúdo (Tasks 4-7) sobre o payload único de /api/gold-preview (Tasks 1-3).
//
// O estado é da ABA, não do bloco: um fetch só alimenta a tela inteira, então
// "loading"/"error"/"forbidden" substituem TODO o conteúdo — nunca um bloco
// de cada vez — e só "ready" chega a renderizar os componentes de conteúdo.
// Sem número de fallback em nenhum caminho: um payload que não chegou não diverge de "vazio".
//
// id="tab-analise-sinistro" e a classe "tab-content" são o contrato com
// public/scripts/features/core.js (mostra/esconde por classe "active") e com
// as regras de modo MDS de styles/dashboard.css — precisam sobreviver
// intactos para a aba continuar aparecendo/desaparecendo certo no menu.

import styles from "./ClaimsTab.module.css";
import { Concentration } from "./components/Concentration";
import { EventMix } from "./components/EventMix";
import { ExecutiveKpis } from "./components/ExecutiveKpis";
import { FacetPanel } from "./components/FacetPanel";
import { Hospitalization } from "./components/Hospitalization";
import { ClaimsHeader } from "./components/ClaimsHeader";
import { Locations } from "./components/Locations";
import { Methodology } from "./components/Methodology";
import { MonthlySeries } from "./components/MonthlySeries";
import { SanusImpact } from "./components/SanusImpact";
import { SanusJourney } from "./components/SanusJourney";
import { useGoldPreview } from "./hooks/useGoldPreview";
import { useGoldPreviewFilters } from "./hooks/useGoldPreviewFilters";
import type { GoldPreview } from "../../contracts/gold-preview";
import { LineageDrawer } from "../sinistralidade/components/LineageDrawer";
import { LineageProvider } from "../sinistralidade/components/LineageProvider";

export function ClaimsTab() {
  const filtros = useGoldPreviewFilters();
  const { status, data, error, retry } = useGoldPreview(filtros.querystring);
  const temFiltroAplicado = Object.values(filtros.aplicados).some((valores) => valores.length > 0);

  return (
    <section id="tab-analise-sinistro" className={`tab-content ${styles.root}`}>
      <LineageProvider available={data?.fonte.role === "full"}>
        {status === "loading" ? (
          <div className={styles.loading} role="status">
            Carregando a análise de sinistro…
          </div>
        ) : null}

        {status === "forbidden" ? (
          <div className={styles.forbidden} role="status">
            <strong>Indisponível para o seu perfil.</strong>
            <span>{error ?? "Este perfil não tem acesso à análise de sinistro."}</span>
          </div>
        ) : null}

        {status === "error" ? (
          <div className={styles.errorState} role="alert">
            <strong>Não foi possível carregar a análise de sinistro.</strong>
            <span>{error}</span>
            <div className={styles.errorActions}>
              <button type="button" onClick={retry}>
                Tentar novamente
              </button>
              {/* "Tentar novamente" sozinho reenvia a MESMA querystring — se a
                  falha for causada por um recorte de facetas (já escrito na URL
                  por useGoldPreviewFilters), o usuário fica sem saída a não ser
                  editar a URL à mão. "Limpar filtros" some com o recorte
                  aplicado e dispara uma nova busca sem filtros — só aparece
                  quando há algo para limpar. */}
              {temFiltroAplicado ? (
                <button type="button" onClick={filtros.limpar}>
                  Limpar filtros
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {status === "ready" && data ? <ClaimsContent data={data} filtros={filtros} /> : null}

        <LineageDrawer />
      </LineageProvider>
    </section>
  );
}

// Ordem dos blocos de conteúdo: a mesma numeração B1-B8 que os comentários de
// cada componente usam para citar o fragmento legado (src/dashboard/fragments/gold-preview.html) —
// KPIs, B1 (mensal/competência/trimestral), B2 (composição por evento), B3
// (lotações), B4 (concentração + prestadores), B5
// (internação + saúde mental), B6/B7 (impacto Sanus + comparação madura), B8
// (jornada Sanus) e o card de metodologia no rodapé.
function ClaimsContent({
  data,
  filtros,
}: {
  data: GoldPreview;
  filtros: ReturnType<typeof useGoldPreviewFilters>;
}) {
  return (
    <>
      <ClaimsHeader fonte={data.fonte} carteira={data.carteira} periodo={data.kpis.periodo} />
      <FacetPanel disponiveis={data.filtros.disponiveis} notas={data.filtros.notas} filtros={filtros} />
      <ExecutiveKpis kpis={data.kpis} />
      <MonthlySeries mensal={data.mensal} competencia={data.competencia} />
      <EventMix data={data.composicao_tipo_evento} />
      <Locations lotacoes={data.lotacoes} />
      <Concentration concentracao={data.concentracao} prestadores={data.prestadores} />
      <Hospitalization internacao={data.internacao} saudeMental={data.saude_mental} />
      <SanusImpact impacto={data.impacto_sanus} comparacao={data.comparacao_madura} ultimoMesFechado={data.kpis.ultimo_mes_fechado} />
      <SanusJourney jornada={data.jornada_sanus} />
      <Methodology />
    </>
  );
}
