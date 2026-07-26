"use client";

// Estado do modo "Análise Databricks": ligado/desligado e qual bloco está
// selecionado. Fica num contexto para que o toggle no cabeçalho, os alvos
// espalhados pela página e a gaveta não precisem se conhecer.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useLineageRegistry, type LineageStatus } from "../hooks/useLineageRegistry";
import type { LineageEntry } from "../types";

type LineageContextValue = {
  /** Papel do usuário permite inspecionar linhagem. Falso esconde o recurso inteiro. */
  available: boolean;
  enabled: boolean;
  toggle: () => void;
  status: LineageStatus;
  activeId: string | null;
  open: (id: string) => void;
  close: () => void;
  entry: LineageEntry | null;
  entries: Map<string, LineageEntry>;
  retry: () => void;
};

const LineageContext = createContext<LineageContextValue | null>(null);

export function LineageProvider({ available, children }: { available: boolean; children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // available falso nunca liga o modo, mesmo que algo chame toggle().
  const active = available && enabled;
  const { status, entries, retry } = useLineageRegistry(active);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      // Desligar o modo fecha a gaveta: alvo selecionado sem modo ativo não faz sentido.
      if (current) setActiveId(null);
      return !current;
    });
  }, []);

  const open = useCallback((id: string) => setActiveId(id), []);
  const close = useCallback(() => setActiveId(null), []);

  const value = useMemo<LineageContextValue>(
    () => ({
      available,
      enabled: active,
      toggle,
      status,
      activeId,
      open,
      close,
      entry: activeId ? (entries.get(activeId) ?? null) : null,
      entries,
      retry,
    }),
    [available, active, toggle, status, activeId, open, close, entries, retry],
  );

  return <LineageContext.Provider value={value}>{children}</LineageContext.Provider>;
}

export function useLineage(): LineageContextValue {
  const value = useContext(LineageContext);
  if (!value) throw new Error("useLineage exige LineageProvider acima na árvore.");
  return value;
}
