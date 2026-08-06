"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api/client";
import {
  activityLogsResponseSchema,
  type LoginActivityEvent,
} from "../../../contracts/activity-logs";

type Loaded = {
  attempt: number;
  kind: "ready" | "forbidden" | "error";
  events: LoginActivityEvent[] | null;
  error: string | null;
};

export function useActivityLogs(enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiRequest("/api/admin/activity-logs", { schema: activityLogsResponseSchema })
      .then((data) => {
        if (cancelled) return;
        setLoaded({ attempt, kind: "ready", events: data.events, error: null });
      })
      .catch((cause) => {
        if (cancelled) return;
        const httpStatus = (cause as { status?: number })?.status;
        setLoaded({
          attempt,
          kind: httpStatus === 403 ? "forbidden" : "error",
          events: null,
          error: cause instanceof Error ? cause.message : "Não foi possível carregar os logs.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, enabled]);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  const status = !enabled ? "idle" : current ? current.kind : "loading";

  return {
    events: current?.events ?? null,
    status,
    error: current?.error ?? null,
    reload: () => setAttempt((value) => value + 1),
  };
}
