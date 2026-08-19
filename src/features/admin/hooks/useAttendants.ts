"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
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
  error: string | null;
};

export function useAttendants() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest("/api/admin/attendants", { schema: attendantsListResponseSchema })
      .then((data) => {
        if (cancelled) return;
        setLoaded({
          attempt,
          kind: "ready",
          candidates: data.candidates,
          mappings: data.mappings,
          departments: data.departments,
          error: null,
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        const status = cause?.status ?? cause?.response?.status;
        setLoaded({
          attempt,
          kind: status === 403 ? "forbidden" : "error",
          candidates: [],
          mappings: [],
          departments: [...ATTENDANT_DEPARTMENTS],
          error: cause instanceof Error ? cause.message : "Falha ao carregar atendentes.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const status = useMemo(() => {
    if (!loaded || loaded.attempt !== attempt) return "loading" as const;
    return loaded.kind;
  }, [loaded, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

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
        setLoaded((current) => {
          if (!current || current.kind !== "ready") return current;
          const others = current.mappings.filter(
            (item) => item.name.trim().toLowerCase() !== response.mapping.name.trim().toLowerCase(),
          );
          return {
            ...current,
            mappings: [...others, response.mapping].sort((a, b) =>
              a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
            ),
          };
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
    error: loaded?.attempt === attempt ? loaded.error : null,
    candidates: loaded?.attempt === attempt ? loaded.candidates : [],
    mappings: loaded?.attempt === attempt ? loaded.mappings : [],
    departments: loaded?.attempt === attempt ? loaded.departments : [...ATTENDANT_DEPARTMENTS],
    saving,
    reload,
    saveMapping,
  };
}

export const attendantRowSchema = z.object({
  name: z.string(),
  department: z.enum(ATTENDANT_DEPARTMENTS),
  status: z.enum(["Ativo", "Inativo"]),
});
