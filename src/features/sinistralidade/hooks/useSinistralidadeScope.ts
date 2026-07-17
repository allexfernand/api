"use client";

// Busca de um escopo 1.1.0 com estados explícitos por bloco:
// idle | loading | refreshing | success | blocked | forbidden | error.
// Resultados anteriores são preservados durante a troca de filtros
// (stale-while-refreshing), com indicação de atualização. O status de
// carregamento é derivado (path pedido ≠ path carregado), sem setState
// síncrono dentro do efeito.

import { useCallback, useEffect, useState } from "react";
import type { LongitudinalEnvelope, ScopeResponse } from "../types";

export type ScopeStatus = "idle" | "loading" | "refreshing" | "success" | "blocked" | "forbidden" | "error";

export type ScopeResult<T> = {
  status: ScopeStatus;
  data: T | null;
  envelope: LongitudinalEnvelope | null;
  error: string | null;
  retry: () => void;
};

type Loaded<T> = {
  path: string;
  attempt: number;
  kind: "success" | "blocked" | "forbidden" | "error";
  data: T | null;
  envelope: LongitudinalEnvelope | null;
  error: string | null;
};

export function useSinistralidadeScope<T>(path: string | null): ScopeResult<T> {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    fetch(path, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<ScopeResponse<T>> & { error?: string };
        if (cancelled) return;
        const base = { path, attempt, envelope: body.source ?? null };
        if (response.status === 409) {
          setLoaded({ ...base, kind: "blocked", data: null, error: body.error ?? null });
        } else if (response.status === 403) {
          setLoaded({ ...base, kind: "forbidden", data: null, error: body.error ?? "Sem permissão." });
        } else if (!response.ok) {
          setLoaded({ ...base, kind: "error", data: null, error: body.error ?? `Falha ${response.status}` });
        } else {
          setLoaded({ ...base, kind: "success", data: (body.data ?? null) as T | null, error: null });
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoaded({
          path,
          attempt,
          kind: "error",
          data: null,
          envelope: null,
          error: cause instanceof Error ? cause.message : "Falha de rede.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (!path) return { status: "idle", data: null, envelope: null, error: null, retry };
  if (!loaded || loaded.path !== path || loaded.attempt !== attempt) {
    const stale = loaded && loaded.kind === "success" ? loaded : null;
    return {
      status: stale ? "refreshing" : "loading",
      data: stale?.data ?? null,
      envelope: stale?.envelope ?? null,
      error: null,
      retry,
    };
  }
  return { status: loaded.kind, data: loaded.data, envelope: loaded.envelope, error: loaded.error, retry };
}

export function scopeUrl(
  scope: string,
  params: Record<string, string | number | boolean | undefined>,
) {
  const search = new URLSearchParams({ scope });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return `/api/sinistralidade/v2?${search}`;
}
