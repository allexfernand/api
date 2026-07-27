"use client";

// Busca o registro de linhagem uma única vez, na primeira vez que o modo é
// ligado. É metadado estático: não refaz a requisição quando os filtros mudam.
// O status é derivado do resultado da última tentativa (mesmo padrão de
// useSinistralidadeScope), sem setState síncrono dentro do efeito.

import { useCallback, useEffect, useState } from "react";
import type { LineageEntry, LineageRegistry } from "../types";

export type LineageStatus = "idle" | "loading" | "ready" | "error";

export type LineageRegistryResult = {
  status: LineageStatus;
  entries: Map<string, LineageEntry>;
  retry: () => void;
};

const EMPTY = new Map<string, LineageEntry>();

type Settled = { attempt: number; ok: boolean } | null;

export function useLineageRegistry(enabled: boolean): LineageRegistryResult {
  const [entries, setEntries] = useState<Map<string, LineageEntry>>(EMPTY);
  const [settled, setSettled] = useState<Settled>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Já carregado: não refaz. Desligado: não busca.
    if (!enabled || entries.size > 0) return;
    let cancelled = false;
    fetch("/api/sinistralidade/v2?scope=lineage", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Falha ${response.status}`);
        const body = (await response.json()) as { lineage?: LineageRegistry };
        if (cancelled) return;
        const list = body.lineage?.entries ?? [];
        setEntries(new Map(list.map((entry) => [entry.id, entry])));
        setSettled({ attempt, ok: true });
      })
      .catch(() => {
        if (!cancelled) setSettled({ attempt, ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, entries.size, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  const status: LineageStatus = !enabled
    ? "idle"
    : entries.size > 0
      ? "ready"
      : settled && settled.attempt === attempt && !settled.ok
        ? "error"
        : "loading";

  return { status, entries, retry };
}
