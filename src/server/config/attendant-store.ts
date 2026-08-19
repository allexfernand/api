// Mapa atendente → departamento/status (Configurações → Atendentes).
// Mesmo Edge Config dos usuários; chave separada.
import { get } from "@vercel/edge-config";
import { attendantMappingSchema, type AttendantMapping } from "../../contracts/attendants";
import { isEdgeConfigWritable } from "./edge-config-store";

const STORE_KEY = "attendant_departments";

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

let memoryMappings: AttendantMapping[] | null = null;
let memoryMappingsAt = 0;
const MEMORY_TTL_MS = 60_000;

function parseMappings(raw: unknown): AttendantMapping[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => attendantMappingSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
}

function remember(mappings: AttendantMapping[]) {
  memoryMappings = mappings;
  memoryMappingsAt = Date.now();
  return mappings;
}

async function readFromRestApi(): Promise<AttendantMapping[] | null> {
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
  if (response.status === 404 || response.status === 204) return [];
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const raw =
    payload && typeof payload === "object" && "value" in payload
      ? (payload as { value: unknown }).value
      : payload;
  return parseMappings(raw);
}

export async function readAttendantMappings(): Promise<AttendantMapping[]> {
  if (memoryMappings && Date.now() - memoryMappingsAt < MEMORY_TTL_MS) {
    return memoryMappings;
  }

  if (isEdgeConfigWritable()) {
    const fromApi = await readFromRestApi().catch(() => null);
    if (fromApi) return remember(fromApi);
  }

  if (!process.env.EDGE_CONFIG) return memoryMappings ?? [];
  const raw = await get(STORE_KEY).catch(() => null);
  return remember(parseMappings(raw));
}

export async function writeAttendantMappings(mappings: AttendantMapping[]): Promise<void> {
  const edgeConfigId = writeEdgeConfigId();
  const apiToken = writeToken();
  if (!edgeConfigId || !apiToken) {
    throw new Error(
      "Edge Config sem credencial de escrita. Defina EDGE_CONFIG_ID, EDGE_CONFIG_WRITE_TOKEN e EDGE_CONFIG_TEAM_ID.",
    );
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
      items: [{ operation: "upsert", key: STORE_KEY, value: mappings }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao gravar atendentes no Edge Config (HTTP ${response.status}). ${detail}`.trim());
  }

  remember(mappings);
}

export function invalidateAttendantMappingsCache() {
  memoryMappings = null;
  memoryMappingsAt = 0;
}
