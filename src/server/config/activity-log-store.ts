// Últimos logins da plataforma (Configurações → Logs de atividade).
// Mesmo Edge Config dos usuários gerenciados; chave separada para não
// misturar tráfego de login com CRUD de usuários.
import { get } from "@vercel/edge-config";
import {
  loginActivityEventSchema,
  loginActivityListSchema,
  type LoginActivityEvent,
  type LoginActivityVia,
} from "../../contracts/activity-logs";
import { logger } from "../observability/logger";
import { isEdgeConfigWritable } from "./edge-config-store";

const STORE_KEY = "login_activity";
const MAX_EVENTS = 200;

function trimEnv(name: string) {
  const value = process.env[name];
  return value ? value.trim() : "";
}

function writeToken() {
  return trimEnv("EDGE_CONFIG_WRITE_TOKEN");
}

function writeTeamId() {
  return trimEnv("EDGE_CONFIG_TEAM_ID");
}

function writeEdgeConfigId() {
  return trimEnv("EDGE_CONFIG_ID");
}

let memoryEvents: LoginActivityEvent[] | null = null;
let memoryEventsAt = 0;
const MEMORY_TTL_MS = 30_000;

function parseEvents(raw: unknown): LoginActivityEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => loginActivityEventSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
}

function remember(events: LoginActivityEvent[]) {
  memoryEvents = events;
  memoryEventsAt = Date.now();
  return events;
}

async function readFromRestApi(): Promise<LoginActivityEvent[] | null> {
  const edgeConfigId = writeEdgeConfigId();
  const apiToken = writeToken();
  if (!edgeConfigId || !apiToken) return null;
  const teamId = writeTeamId();
  const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const response = await fetch(
    `https://api.vercel.com/v1/edge-config/${edgeConfigId}/item/${STORE_KEY}${teamQuery}`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: "no-store",
    },
  );
  if (response.status === 404) return [];
  if (response.status === 204) return [];
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const raw =
    payload && typeof payload === "object" && "value" in payload
      ? (payload as { value: unknown }).value
      : payload;
  return parseEvents(raw);
}

async function writeEvents(events: LoginActivityEvent[]): Promise<void> {
  const edgeConfigId = writeEdgeConfigId();
  const apiToken = writeToken();
  if (!edgeConfigId || !apiToken) {
    throw new Error("Edge Config sem credencial de escrita para logs de atividade.");
  }

  const teamId = writeTeamId();
  const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const response = await fetch(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items${teamQuery}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ operation: "upsert", key: STORE_KEY, value: events }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao gravar logs de atividade (HTTP ${response.status}). ${detail}`.trim());
  }
  remember(events);
}

export async function readLoginActivity(): Promise<LoginActivityEvent[]> {
  if (memoryEvents && Date.now() - memoryEventsAt < MEMORY_TTL_MS) {
    return memoryEvents;
  }

  if (isEdgeConfigWritable()) {
    const fromApi = await readFromRestApi().catch(() => null);
    if (fromApi) return remember(fromApi);
  }

  if (!process.env.EDGE_CONFIG) return memoryEvents ?? [];
  const raw = await get(STORE_KEY).catch(() => null);
  const parsed = loginActivityListSchema.safeParse(raw);
  return remember(parsed.success ? parsed.data : parseEvents(raw));
}

export function clientIpFromRequest(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);
  const vercel = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel.slice(0, 128);
  return null;
}

export function userAgentFromRequest(request: Request): string | null {
  const ua = request.headers.get("user-agent")?.trim();
  if (!ua) return null;
  return ua.slice(0, 280);
}

/** Grava o login; nunca deve derrubar a emissão da sessão. */
export async function recordLoginActivity(input: {
  user: string;
  request: Request;
  via: LoginActivityVia;
}): Promise<void> {
  if (!isEdgeConfigWritable()) return;

  const event: LoginActivityEvent = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    user: input.user,
    at: new Date().toISOString(),
    ip: clientIpFromRequest(input.request),
    userAgent: userAgentFromRequest(input.request),
    via: input.via,
  };

  try {
    const existing = await readLoginActivity();
    const next = [event, ...existing].slice(0, MAX_EVENTS);
    await writeEvents(next);
  } catch (cause) {
    logger.warn("login_activity_write_failed", {
      user: input.user,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
