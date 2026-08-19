"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api/client";
import {
  ATTENDANT_DEPARTMENTS,
  attendantsListResponseSchema,
  type AttendantCandidate,
  type AttendantDepartment,
  type AttendantMapping,
  type AttendantStatus,
  upsertAttendantMappingResponseSchema,
} from "../../../contracts/attendants";

type Loaded = {
  attempt: number;
  kind: "ready" | "forbidden" | "error";
  candidates: AttendantCandidate[];
  mappings: AttendantMapping[];
  departments: AttendantDepartment[];
  candidatesError: string | null;
  candidatesLoading: boolean;
  error: string | null;
};

export function useAttendants() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 1) Edge Config (rápido) — libera a tela mesmo se o Databricks demorar.
    apiRequest("/api/admin/attendants?lite=1", { schema: attendantsListResponseSchema })
      .then((data) => {
        if (cancelled) return;
        setLoaded({
          attempt,
          kind: "ready",
          candidates: data.candidates,
          mappings: data.mappings,
          departments: data.departments,
          candidatesError: null,
          candidatesLoading: true,
          error: null,
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        const status = (cause as { status?: number })?.status;
        setLoaded({
          attempt,
          kind: status === 403 ? "forbidden" : "error",
          candidates: [],
          mappings: [],
          departments: [...ATTENDANT_DEPARTMENTS],
          candidatesError: null,
          candidatesLoading: false,
          error: cause instanceof Error ? cause.message : "Falha ao carregar atendentes.",
        });
      });

    // 2) finished_by no Databricks (pode demorar) — mescla depois.
    apiRequest("/api/admin/attendants?months=12", { schema: attendantsListResponseSchema })
      .then((data) => {
        if (cancelled) return;
        setLoaded({
          attempt,
          kind: "ready",
          candidates: data.candidates,
          mappings: data.mappings,
          departments: data.departments,
          candidatesError: data.candidatesError ?? null,
          candidatesLoading: false,
          error: null,
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoaded((current) => {
          if (!current || current.attempt !== attempt || current.kind !== "ready") {
            const status = (cause as { status?: number })?.status;
            return {
              attempt,
              kind: status === 403 ? "forbidden" : "error",
              candidates: [],
              mappings: [],
              departments: [...ATTENDANT_DEPARTMENTS],
              candidatesError: null,
              candidatesLoading: false,
              error: cause instanceof Error ? cause.message : "Falha ao carregar atendentes.",
            };
          }
          return {
            ...current,
            candidatesLoading: false,
            candidatesError:
              cause instanceof Error
                ? cause.message
                : "Não foi possível carregar finished_by no Databricks.",
          };
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  const status = current ? current.kind : "loading";

  const saveMapping = useCallback(
    async (input: {
      name: string;
      department: AttendantDepartment;
      status: AttendantStatus;
      displayName?: string;
    }) => {
      setSaving(input.name);
      try {
        const response = await apiRequest("/api/admin/attendants", {
          method: "PUT",
          body: JSON.stringify(input),
          schema: upsertAttendantMappingResponseSchema,
        });
        setLoaded((prev) => {
          if (!prev || prev.kind !== "ready") return prev;
          const others = prev.mappings.filter(
            (item) => item.name.trim().toLowerCase() !== response.mapping.name.trim().toLowerCase(),
          );
          const mappings = [...others, response.mapping].sort((a, b) =>
            a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
          );
          const hasCandidate = prev.candidates.some(
            (item) => item.name.trim().toLowerCase() === response.mapping.name.trim().toLowerCase(),
          );
          const candidates = hasCandidate
            ? prev.candidates
            : [
                ...prev.candidates,
                { name: response.mapping.name, sessions: 0, lastSeen: null },
              ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
          return { ...prev, mappings, candidates };
        });
        return response.mapping;
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  return {
    status,
    error: current?.error ?? null,
    candidates: current?.candidates ?? [],
    mappings: current?.mappings ?? [],
    departments: current?.departments ?? [...ATTENDANT_DEPARTMENTS],
    candidatesError: current?.candidatesError ?? null,
    candidatesLoading: current?.candidatesLoading ?? false,
    saving,
    reload,
    saveMapping,
  };
}
