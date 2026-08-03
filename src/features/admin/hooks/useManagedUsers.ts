"use client";

// Mesmo desenho de useGoldPreview: o status é derivado comparando o último
// resultado carregado com a tentativa atual, sem setState síncrono dentro do
// efeito (regra react-hooks/set-state-in-effect).

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { apiRequest } from "../../../lib/api/client";
import {
  managedDashboardUserPublicSchema,
  managedUsersListResponseSchema,
  type CreateManagedUserRequest,
  type ManagedDashboardUserPublic,
  type UpdateManagedUserRequest,
} from "../../../contracts/dashboard-users";

const userResponseSchema = z.object({ user: managedDashboardUserPublicSchema });

export type PartnerOption = { broker_id: string; broker_name: string };
export type PartnerGroupMap = Record<string, string[]>;

type Loaded = {
  attempt: number;
  kind: "ready" | "forbidden" | "error";
  users: ManagedDashboardUserPublic[] | null;
  economicGroups: string[];
  partners: PartnerOption[];
  partnerGroupMap: PartnerGroupMap;
  error: string | null;
};

export function useManagedUsers() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest("/api/admin/users", { schema: managedUsersListResponseSchema })
      .then((data) => {
        if (cancelled) return;
        setLoaded({
          attempt,
          kind: "ready",
          users: data.users,
          economicGroups: data.economicGroups,
          partners: data.partners,
          partnerGroupMap: data.partnerGroupMap,
          error: null,
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        const httpStatus = (cause as { status?: number })?.status;
        setLoaded({
          attempt,
          kind: httpStatus === 403 ? "forbidden" : "error",
          users: null,
          economicGroups: [],
          partners: [],
          partnerGroupMap: {},
          error: cause instanceof Error ? cause.message : "Não foi possível carregar os usuários.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  const status = current ? current.kind : "loading";
  const users = current?.users ?? null;
  const economicGroups = current?.economicGroups ?? [];
  const partners = current?.partners ?? [];
  const partnerGroupMap = current?.partnerGroupMap ?? {};
  const error = current?.error ?? null;

  const createUser = useCallback(
    async (input: CreateManagedUserRequest) => {
      const data = await apiRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(input),
        schema: userResponseSchema,
      });
      reload();
      return data.user;
    },
    [reload],
  );

  const updateUser = useCallback(
    async (username: string, input: UpdateManagedUserRequest) => {
      const data = await apiRequest(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
        schema: userResponseSchema,
      });
      reload();
      return data.user;
    },
    [reload],
  );

  const deleteUser = useCallback(
    async (username: string) => {
      await apiRequest(`/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
      reload();
    },
    [reload],
  );

  return { users, economicGroups, partners, partnerGroupMap, status, error, reload, createUser, updateUser, deleteUser };
}
