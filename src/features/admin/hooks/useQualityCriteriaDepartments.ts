"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api/client";
import {
  QUALITY_CRITERIA_DEPARTMENTS,
  qualityCriteriaDepartmentsListResponseSchema,
  upsertQualityCriterionDepartmentsResponseSchema,
  type QualityCriteriaDepartment,
  type QualityCriterionCandidate,
  type QualityCriterionDepartmentMapping,
} from "../../../contracts/quality-criteria-departments";

type Loaded = {
  attempt: number;
  kind: "ready" | "forbidden" | "error";
  candidates: QualityCriterionCandidate[];
  mappings: QualityCriterionDepartmentMapping[];
  departments: QualityCriteriaDepartment[];
  candidatesError: string | null;
  candidatesLoading: boolean;
  error: string | null;
};

export function useQualityCriteriaDepartments() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiRequest("/api/admin/quality-criteria-departments?lite=1", {
      schema: qualityCriteriaDepartmentsListResponseSchema,
    })
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
          departments: [...QUALITY_CRITERIA_DEPARTMENTS],
          candidatesError: null,
          candidatesLoading: false,
          error: cause instanceof Error ? cause.message : "Falha ao carregar critérios.",
        });
      });

    apiRequest("/api/admin/quality-criteria-departments", {
      schema: qualityCriteriaDepartmentsListResponseSchema,
    })
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
          if (!current || current.attempt !== attempt || current.kind !== "ready") return current;
          return {
            ...current,
            candidatesLoading: false,
            candidatesError:
              cause instanceof Error
                ? cause.message
                : "Não foi possível carregar subcritérios no Databricks.",
          };
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const saveMapping = useCallback(
    async (input: {
      criterio_id: string;
      sub_criterio?: string;
      departments: QualityCriteriaDepartment[];
    }) => {
      setSaving(input.criterio_id);
      try {
        const response = await apiRequest("/api/admin/quality-criteria-departments", {
          method: "PUT",
          body: JSON.stringify(input),
          schema: upsertQualityCriterionDepartmentsResponseSchema,
        });
        setLoaded((current) => {
          if (!current || current.kind !== "ready") return current;
          const key = input.criterio_id.trim().toLowerCase();
          const mappings = current.mappings.filter(
            (item) => item.criterio_id.trim().toLowerCase() !== key,
          );
          mappings.push(response.mapping);
          mappings.sort((a, b) =>
            a.criterio_id.localeCompare(b.criterio_id, "pt-BR", { numeric: true }),
          );
          return { ...current, mappings };
        });
        return response.mapping;
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  return useMemo(() => {
    const status =
      !loaded || loaded.attempt !== attempt
        ? "loading"
        : loaded.kind === "ready"
          ? "ready"
          : loaded.kind;
    return {
      status,
      error: loaded?.error ?? null,
      candidates: loaded?.candidates ?? [],
      mappings: loaded?.mappings ?? [],
      departments: loaded?.departments ?? [...QUALITY_CRITERIA_DEPARTMENTS],
      candidatesError: loaded?.candidatesError ?? null,
      candidatesLoading: loaded?.candidatesLoading ?? false,
      saving,
      reload,
      saveMapping,
    };
  }, [attempt, loaded, saving, reload, saveMapping]);
}
