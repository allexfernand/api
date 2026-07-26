"use client";

// Facetas da aba Análise Sinistro, com seleção pendente e seleção aplicada
// separadas: `alternar` só mexe na pendente, e é `aplicar` que copia a
// pendente para a aplicada — só a aplicada alimenta `querystring` e a URL.
// Isso preserva o comportamento atual da aba: o usuário monta o recorte e
// confirma com "Aplicar recorte", nada recarrega a cada clique.
//
// Sincronizado com a URL (prefixo pg_, valores separados por vírgula) para
// que o recorte aplicado seja compartilhável, espelhando
// useSinistralidadeFilters. A querystring da busca em si usa os nomes de
// campo que o servidor espera (sem prefixo, uma chave repetida por valor —
// é assim que `adaptLegacyRoute` e `parseMulti` leem múltiplos valores).

import { useCallback, useEffect, useMemo, useState } from "react";

export type FacetField = "faixa_etaria" | "sexo" | "tipo_plano" | "cidade" | "estado" | "servico_sanus";
export type FacetSelection = Record<FacetField, string[]>;

const FACET_FIELDS: FacetField[] = ["faixa_etaria", "sexo", "tipo_plano", "cidade", "estado", "servico_sanus"];

const URL_PARAM: Record<FacetField, string> = {
  faixa_etaria: "pg_faixa_etaria",
  sexo: "pg_sexo",
  tipo_plano: "pg_tipo_plano",
  cidade: "pg_cidade",
  estado: "pg_estado",
  servico_sanus: "pg_servico_sanus",
};

function selecaoVazia(): FacetSelection {
  return { faixa_etaria: [], sexo: [], tipo_plano: [], cidade: [], estado: [], servico_sanus: [] };
}

function lerDaUrl(): FacetSelection {
  const selecao = selecaoVazia();
  if (typeof window === "undefined") return selecao;
  const params = new URLSearchParams(window.location.search);
  for (const campo of FACET_FIELDS) {
    const bruto = params.get(URL_PARAM[campo]);
    if (!bruto) continue;
    selecao[campo] = [...new Set(bruto.split(",").map((valor) => valor.trim()).filter(Boolean))];
  }
  return selecao;
}

function selecoesIguais(a: FacetSelection, b: FacetSelection) {
  return FACET_FIELDS.every((campo) => {
    const av = [...a[campo]].sort();
    const bv = [...b[campo]].sort();
    return av.length === bv.length && av.every((valor, i) => valor === bv[i]);
  });
}

function querystringDe(selecao: FacetSelection) {
  const params = new URLSearchParams();
  for (const campo of FACET_FIELDS) {
    for (const valor of selecao[campo]) params.append(campo, valor);
  }
  return params.toString();
}

export function useGoldPreviewFilters() {
  const [aplicados, setAplicados] = useState<FacetSelection>(() => lerDaUrl());
  const [selecionados, setSelecionados] = useState<FacetSelection>(() => lerDaUrl());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    for (const campo of FACET_FIELDS) {
      const valores = aplicados[campo];
      if (valores.length) params.set(URL_PARAM[campo], valores.join(","));
      else params.delete(URL_PARAM[campo]);
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
  }, [aplicados]);

  const alternar = useCallback((campo: FacetField, valor: string) => {
    setSelecionados((atual) => {
      const lista = atual[campo];
      const existe = lista.includes(valor);
      return { ...atual, [campo]: existe ? lista.filter((v) => v !== valor) : [...lista, valor] };
    });
  }, []);

  const limpar = useCallback(() => {
    // Espelha o botão "Limpar" atual: some com o recorte pendente e já
    // aplica a visão total — mesmo efeito de "Aplicar" com seleção vazia.
    const vazio = selecaoVazia();
    setSelecionados(vazio);
    setAplicados(vazio);
  }, []);

  const aplicar = useCallback(() => {
    setAplicados(selecionados);
  }, [selecionados]);

  const querystring = useMemo(() => querystringDe(aplicados), [aplicados]);
  const sujo = useMemo(() => !selecoesIguais(selecionados, aplicados), [selecionados, aplicados]);

  return { selecionados, aplicados, alternar, limpar, aplicar, querystring, sujo };
}
