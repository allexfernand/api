"use client";

// Painel de facetas da aba Análise Sinistro: seis dimensões com
// multisseleção, chips do recorte pendente, contador e os botões
// "Limpar tudo" / "Aplicar recorte". Porta o comportamento de
// renderControlesFiltro/renderOpcoes/renderResumoFiltros/populateFiltros
// (public/scripts/gold-preview.js) para React, com dois ajustes:
//
// - opções são <button> reais com aria-pressed, não <input type="checkbox">;
// - a nota fixa "Linha de cuidado ainda não está disponível na fonte
//   Databricks" não sobrevive — essa faceta não existe no payload. Em vez
//   disso, `notas` (filtros.notas do servidor) é renderizada como veio, sem
//   nenhum texto inventado aqui.
//
// A busca dentro da lista de opções sobrevive (relevante quando a faceta tem
// muitos valores, como cidade — até 40), assim como o texto de status
// descrevendo o recorte atual.

import { useState } from "react";
import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import type { FacetField, FacetSelection } from "../hooks/useGoldPreviewFilters";

const FACET_FIELDS: FacetField[] = ["faixa_etaria", "sexo", "tipo_plano", "estado", "cidade", "servico_sanus"];

const FACET_META: Record<FacetField, { label: string; icon: string; hint: string }> = {
  faixa_etaria: { label: "Faixa etária", icon: "fa-user-clock", hint: "Todas as idades" },
  sexo: { label: "Sexo", icon: "fa-venus-mars", hint: "Todos os sexos" },
  tipo_plano: { label: "Tipo de plano", icon: "fa-id-card", hint: "Todos os planos" },
  estado: { label: "Estado do titular", icon: "fa-map", hint: "Todos os estados" },
  cidade: { label: "Cidade do titular", icon: "fa-location-dot", hint: "Todas as cidades" },
  servico_sanus: { label: "Serviço Sanus na família", icon: "fa-heart-pulse", hint: "Todos os serviços" },
};

type Opcao = { value: string; label: string };

function normalizarOpcao(bruto: unknown): Opcao {
  if (bruto && typeof bruto === "object") {
    const item = bruto as { valor?: unknown; label?: unknown };
    const value = item.valor == null ? "" : String(item.valor);
    return { value, label: item.label == null ? value : String(item.label) };
  }
  return { value: bruto == null ? "" : String(bruto), label: bruto == null ? "" : String(bruto) };
}

// `disponiveis` é `z.object({}).passthrough()` no contrato — as chaves variam
// conforme os filtros ativos no servidor. Além das opções que o servidor
// devolve, garante que um valor já selecionado (ex.: vindo da URL) continue
// aparecendo na lista mesmo que o servidor não o traga mais, igual ao
// `populateFiltros` original.
function opcoesDoCampo(disponiveis: GoldPreview["filtros"]["disponiveis"], campo: FacetField, selecionados: string[]): Opcao[] {
  const bruto = (disponiveis as Record<string, unknown>)[campo];
  const opcoes = Array.isArray(bruto) ? bruto.map(normalizarOpcao).filter((item) => item.value !== "") : [];
  for (const valor of selecionados) {
    if (!opcoes.some((item) => item.value === valor)) opcoes.push({ value: valor, label: valor });
  }
  return opcoes;
}

export function FacetPanel({
  disponiveis,
  notas,
  filtros,
}: {
  disponiveis: GoldPreview["filtros"]["disponiveis"];
  notas: GoldPreview["filtros"]["notas"];
  filtros: {
    selecionados: FacetSelection;
    aplicados: FacetSelection;
    alternar: (campo: FacetField, valor: string) => void;
    limpar: () => void;
    aplicar: () => void;
    querystring: string;
    sujo: boolean;
  };
}) {
  const [campoAberto, setCampoAberto] = useState<FacetField | null>(null);
  const [buscaPorCampo, setBuscaPorCampo] = useState<Record<FacetField, string>>({
    faixa_etaria: "",
    sexo: "",
    tipo_plano: "",
    estado: "",
    cidade: "",
    servico_sanus: "",
  });

  const totalSelecionado = FACET_FIELDS.reduce((total, campo) => total + filtros.selecionados[campo].length, 0);

  const statusTexto = filtros.sujo
    ? totalSelecionado
      ? `${totalSelecionado} ${totalSelecionado === 1 ? "valor selecionado" : "valores selecionados"} — aplique para recalcular a análise.`
      : "O recorte foi removido — aplique para voltar à visão completa."
    : totalSelecionado
      ? `Recorte aplicado em todos os blocos com ${totalSelecionado} ${totalSelecionado === 1 ? "seleção" : "seleções"}.`
      : "Visão total da carteira, sem filtros.";

  return (
    <section className={styles.filterPanel} aria-labelledby="claims-filter-title">
      <div className={styles.filterHead}>
        <div className={styles.filterHeading}>
          <span className={styles.filterHeadingIcon} aria-hidden="true">
            <i className="fa-solid fa-sliders" />
          </span>
          <div>
            <div className={styles.filterTitle} id="claims-filter-title">
              Explore um recorte da carteira
            </div>
            <div className={styles.filterDescription}>
              Combine dimensões e recalcule todos os indicadores, gráficos e insights abaixo.
            </div>
          </div>
        </div>
        <span className={`${styles.filterCount} ${totalSelecionado > 0 ? styles.filterCountActive : ""}`}>
          {totalSelecionado > 0 ? `${totalSelecionado} ${totalSelecionado === 1 ? "seleção" : "seleções"}` : "Visão completa"}
        </span>
      </div>

      <div className={styles.filterFields}>
        {FACET_FIELDS.map((campo) => {
          const meta = FACET_META[campo];
          const selecionados = filtros.selecionados[campo];
          const opcoes = opcoesDoCampo(disponiveis, campo, selecionados);
          const busca = buscaPorCampo[campo];
          const termo = busca.trim().toLocaleLowerCase("pt-BR");
          const opcoesFiltradas = termo ? opcoes.filter((item) => item.label.toLocaleLowerCase("pt-BR").includes(termo)) : opcoes;
          const aberto = campoAberto === campo;
          const valorResumo =
            selecionados.length === 0
              ? "Todos"
              : selecionados.length === 1
                ? (opcoes.find((item) => item.value === selecionados[0])?.label ?? selecionados[0])
                : `${selecionados.length} selecionados`;
          const labelId = `claims-filter-label-${campo}`;
          const triggerId = `claims-filter-trigger-${campo}`;

          return (
            <div className={styles.filterField} key={campo}>
              <span className={styles.filterLabel} id={labelId}>
                {meta.label}
              </span>
              <button
                type="button"
                id={triggerId}
                className={`${styles.filterTrigger} ${selecionados.length > 0 ? styles.filterTriggerActive : ""}`}
                aria-expanded={aberto}
                aria-haspopup="true"
                aria-labelledby={`${labelId} ${triggerId}`}
                onClick={() => setCampoAberto(aberto ? null : campo)}
              >
                <span className={styles.filterTriggerIcon} aria-hidden="true">
                  <i className={`fa-solid ${meta.icon}`} />
                </span>
                <span className={styles.filterTriggerCopy}>
                  <span className={styles.filterTriggerValue}>{valorResumo}</span>
                  <span className={styles.filterTriggerHint}>{meta.hint}</span>
                </span>
                <i className={`fa-solid fa-chevron-down ${styles.filterChevron}`} aria-hidden="true" />
              </button>
              {aberto ? (
                <div className={styles.filterMenu}>
                  <div className={styles.filterSearchWrap}>
                    <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    <input
                      className={styles.filterSearch}
                      type="search"
                      placeholder={`Buscar ${meta.label.toLocaleLowerCase("pt-BR")}`}
                      autoComplete="off"
                      aria-label={`Buscar em ${meta.label}`}
                      value={busca}
                      onChange={(event) => {
                        const valor = event.target.value;
                        setBuscaPorCampo((atual) => ({ ...atual, [campo]: valor }));
                      }}
                    />
                  </div>
                  <div className={styles.filterOptions} role="group" aria-label={meta.label}>
                    {opcoesFiltradas.length === 0 ? (
                      <div className={styles.filterEmpty}>Nenhum valor encontrado.</div>
                    ) : (
                      opcoesFiltradas.map((opcao) => (
                        <button
                          key={opcao.value}
                          type="button"
                          className={styles.filterOption}
                          aria-pressed={selecionados.includes(opcao.value)}
                          onClick={() => filtros.alternar(campo, opcao.value)}
                        >
                          {opcao.label}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {totalSelecionado > 0 ? (
        <div className={styles.filterSelection}>
          <div className={styles.filterSelectionLabel}>Recorte selecionado</div>
          <div className={styles.filterChips}>
            {FACET_FIELDS.flatMap((campo) => {
              const opcoes = opcoesDoCampo(disponiveis, campo, filtros.selecionados[campo]);
              return filtros.selecionados[campo].map((valor) => {
                const label = opcoes.find((item) => item.value === valor)?.label ?? valor;
                return (
                  <span className={styles.filterChip} key={`${campo}-${valor}`}>
                    <span className={styles.filterChipLabel}>
                      {FACET_META[campo].label}: {label}
                    </span>
                    <button
                      type="button"
                      className={styles.filterChipRemove}
                      aria-label={`Remover ${label}`}
                      onClick={() => filtros.alternar(campo, valor)}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  </span>
                );
              });
            })}
          </div>
        </div>
      ) : null}

      <div className={styles.filterFooter}>
        <div className={styles.filterFeedback}>
          <div className={`${styles.filterStatus} ${filtros.sujo ? styles.filterStatusDirty : ""}`} aria-live="polite">
            {statusTexto}
          </div>
          {notas.map((nota) => (
            <div className={styles.filterNote} key={nota}>
              <i className="fa-solid fa-circle-info" aria-hidden="true" /> {nota}
            </div>
          ))}
        </div>
        <div className={styles.filterActions}>
          <button type="button" className={styles.filterClear} disabled={totalSelecionado === 0} onClick={filtros.limpar}>
            Limpar tudo
          </button>
          <button type="button" className={styles.filterApply} disabled={!filtros.sujo} onClick={filtros.aplicar}>
            <i className="fa-solid fa-arrow-rotate-right" aria-hidden="true" />
            <span>Aplicar recorte</span>
          </button>
        </div>
      </div>
    </section>
  );
}
