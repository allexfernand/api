"use client";

// Filtros globais da Sinistralidade 360, sincronizados com a URL para que a
// análise seja compartilhável (empresa, mês final, janela e inclusão parcial).

import { useCallback, useEffect, useState } from "react";

export type WindowMonths = 3 | 6 | 12 | 24;

export type SinistralidadeFilters = {
  companyKey: string;
  endMonth: string;
  windowMonths: WindowMonths;
  includePartial: boolean;
};

const WINDOW_OPTIONS: WindowMonths[] = [3, 6, 12, 24];

function readFromUrl(): Partial<SinistralidadeFilters> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  // Só inclui chaves realmente presentes na URL: uma chave com valor
  // undefined sobrescreveria o padrão no spread.
  const fromUrl: Partial<SinistralidadeFilters> = {};
  const company = params.get("sin_empresa");
  if (company) fromUrl.companyKey = company;
  const endMonth = params.get("sin_mes");
  if (endMonth && /^\d{4}-\d{2}$/.test(endMonth)) fromUrl.endMonth = endMonth;
  const windowMonths = Number(params.get("sin_janela"));
  if (WINDOW_OPTIONS.includes(windowMonths as WindowMonths)) fromUrl.windowMonths = windowMonths as WindowMonths;
  const partial = params.get("sin_parcial");
  if (partial === "true" || partial === "false") fromUrl.includePartial = partial === "true";
  return fromUrl;
}

export function useSinistralidadeFilters() {
  const [filters, setFilters] = useState<SinistralidadeFilters>(() => ({
    companyKey: "",
    endMonth: "",
    windowMonths: 12,
    // Enquanto não houver meses formalmente fechados, a visão observada é o
    // único modo com dados; o estado do período continua sempre visível.
    includePartial: true,
    ...readFromUrl(),
  }));

  useEffect(() => {
    if (typeof window === "undefined" || !filters.companyKey) return;
    const params = new URLSearchParams(window.location.search);
    params.set("sin_empresa", filters.companyKey);
    if (filters.endMonth) params.set("sin_mes", filters.endMonth);
    params.set("sin_janela", String(filters.windowMonths));
    params.set("sin_parcial", String(filters.includePartial));
    window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
  }, [filters]);

  const update = useCallback((patch: Partial<SinistralidadeFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  return { filters, update, windowOptions: WINDOW_OPTIONS };
}
