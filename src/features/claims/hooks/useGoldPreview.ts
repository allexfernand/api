"use client";

// Busca do payload único da aba Análise Sinistro. O status é derivado do
// estado carregado (path/tentativa pedidos vs. os que já resolveram), sem
// setState síncrono dentro do efeito — mesmo desenho de
// useSinistralidadeScope. 403 vira "forbidden" (perfil MDS cai aqui, não é
// falha). Um payload fora do contrato é bug de servidor: vira "error" com
// mensagem explícita, nunca uma tela vazia.

import { useCallback, useEffect, useState } from "react";
import { goldPreviewSchema, type GoldPreview } from "../../../contracts/gold-preview";

export type GoldPreviewStatus = "loading" | "ready" | "forbidden" | "error";

export type GoldPreviewResult = {
  status: GoldPreviewStatus;
  data: GoldPreview | null;
  error: string | null;
  retry: () => void;
};

type Loaded = {
  query: string;
  attempt: number;
  kind: "ready" | "forbidden" | "error";
  data: GoldPreview | null;
  error: string | null;
};

export function useGoldPreview(query: string, enabled = true): GoldPreviewResult {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    const path = `/api/gold-preview${query ? `?${query}` : ""}`;
    fetch(path, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (cancelled) return;
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        const base = { query, attempt };
        if (response.status === 403) {
          setLoaded({ ...base, kind: "forbidden", data: null, error: body.error ?? "Sem permissão." });
          return;
        }
        if (!response.ok) {
          setLoaded({ ...base, kind: "error", data: null, error: body.error ?? `Falha ${response.status}` });
          return;
        }
        const parsed = goldPreviewSchema.safeParse(body);
        if (!parsed.success) {
          setLoaded({
            ...base,
            kind: "error",
            data: null,
            error: "O formato de /api/gold-preview mudou e não bate mais com o contrato esperado.",
          });
          return;
        }
        setLoaded({ ...base, kind: "ready", data: parsed.data, error: null });
      })
      .catch((cause) => {
        if (cancelled || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setLoaded({
          query,
          attempt,
          kind: "error",
          data: null,
          error: cause instanceof Error ? cause.message : "Falha de rede.",
        });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, attempt, enabled]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (!enabled) {
    return { status: "loading", data: null, error: null, retry };
  }
  if (!loaded || loaded.query !== query || loaded.attempt !== attempt) {
    return { status: "loading", data: null, error: null, retry };
  }
  return { status: loaded.kind, data: loaded.data, error: loaded.error, retry };
}
