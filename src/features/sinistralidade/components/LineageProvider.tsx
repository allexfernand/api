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

  // A seleção só é visível com o modo realmente ativo: se available cair
  // (papel do usuário mudou) sem passar por toggle(), a seleção exposta some
  // na mesma renderização — derivado, sem efeito e sem ref durante o render
  // (o lint deste projeto proíbe os dois, ver useLineageRegistry.ts).
  const effectiveActiveId = active ? activeId : null;

  const toggle = useCallback(() => {
    setEnabled((current) => {
      if (current) {
        // Desligar o modo fecha a gaveta: alvo selecionado sem modo ativo não faz sentido.
        setActiveId(null);
      } else {
        // Ligar o modo dispara uma nova tentativa: se a última busca tinha
        // falhado, "settled" fica preso na tentativa antiga e o status
        // derivado mostraria "error" mesmo com uma busca nova em andamento.
        // Bumping o attempt aqui faz o status cair em "loading" de verdade.
        // Se o registro já estiver carregado, o guard `entries.size > 0` do
        // hook garante que isso não dispara uma nova requisição.
        retry();
      }
      return !current;
    });
  }, [retry]);

  const open = useCallback((id: string) => setActiveId(id), []);
  const close = useCallback(() => setActiveId(null), []);

  const value = useMemo<LineageContextValue>(
    () => ({
      available,
      enabled: active,
      toggle,
      status,
      activeId: effectiveActiveId,
      open,
      close,
      entry: effectiveActiveId ? (entries.get(effectiveActiveId) ?? null) : null,
      entries,
      retry,
    }),
    [available, active, toggle, status, effectiveActiveId, open, close, entries, retry],
  );

  return <LineageContext.Provider value={value}>{children}</LineageContext.Provider>;
}

export function useLineage(): LineageContextValue {
  const value = useContext(LineageContext);
  if (!value) throw new Error("useLineage exige LineageProvider acima na árvore.");
  return value;
}

// Variante tolerante para consumidores decorativos (ex.: LineageAnchor), que
// marcam blocos de apresentação reutilizados em vários lugares da árvore.
// Esses blocos podem renderizar antes de qualquer LineageProvider existir
// acima deles — não é um bug do consumidor, é só ordem de montagem — e sem
// provider não há para onde mandar um clique, então null é a resposta certa,
// não uma exceção. useLineage() continua lançando: quem chama useLineage()
// diretamente (a gaveta, o botão de alternância no cabeçalho) genuinamente
// não funciona sem provider, e esconder isso trocaria um bug alto por um
// botão morto silencioso.
export function useLineageOptional(): LineageContextValue | null {
  return useContext(LineageContext);
}
