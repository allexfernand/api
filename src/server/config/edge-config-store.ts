// Armazenamento dos usuários gerenciados (Configurações → permissão de menu)
// no Vercel Edge Config. Leitura usa o SDK oficial (rápida, decorre da env
// var EDGE_CONFIG que o Vercel injeta ao conectar o Edge Config ao projeto).
// Escrita não existe no SDK de leitura — vai direto na REST API do Vercel.
//
// Importante: o SDK `@vercel/edge-config` é cacheado na edge e pode devolver
// valor velho logo depois de um PATCH. Por isso, com credenciais de escrita,
// preferimos ler via REST API (fonte da verdade) e manter um cache em memória
// no processo — evita a troca de senha ser sobrescrita pelo setup do 2FA no
// mesmo request, e falhas de login com a senha nova por leitura stale.
import { get } from "@vercel/edge-config";
import { managedDashboardUserSchema, type ManagedDashboardUser } from "../../contracts/dashboard-users";

const STORE_KEY = "dashboard_users";

function trimEnv(name: string) {
  const value = process.env[name];
  return value ? value.trim() : "";
}

function writeToken() {
  return trimEnv("EDGE_CONFIG_WRITE_TOKEN") || trimEnv("VERCEL_API_TOKEN");
}

function writeTeamId() {
  return trimEnv("EDGE_CONFIG_TEAM_ID") || trimEnv("VERCEL_TEAM_ID");
}

function writeEdgeConfigId() {
  return trimEnv("EDGE_CONFIG_ID");
}

export function isEdgeConfigReadable() {
  return Boolean(process.env.EDGE_CONFIG) || isEdgeConfigWritable();
}

export function isEdgeConfigWritable() {
  return Boolean(writeEdgeConfigId() && writeToken());
}

let memoryUsers: ManagedDashboardUser[] | null = null;
let memoryUsersAt = 0;
const MEMORY_TTL_MS = 60_000;

function parseUsers(raw: unknown): ManagedDashboardUser[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => managedDashboardUserSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
}

function remember(users: ManagedDashboardUser[]) {
  memoryUsers = users;
  memoryUsersAt = Date.now();
  return users;
}

async function readManagedUsersFromRestApi(): Promise<ManagedDashboardUser[] | null> {
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
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  // A API pode devolver o valor direto ou envelopado em `{ value: ... }`.
  const raw = payload && typeof payload === "object" && "value" in payload ? (payload as { value: unknown }).value : payload;
  return parseUsers(raw);
}

export async function readManagedUsers(): Promise<ManagedDashboardUser[]> {
  if (memoryUsers && Date.now() - memoryUsersAt < MEMORY_TTL_MS) {
    return memoryUsers;
  }

  // Fonte da verdade quando temos token de escrita — evita CDN stale.
  if (isEdgeConfigWritable()) {
    const fromApi = await readManagedUsersFromRestApi().catch(() => null);
    if (fromApi) return remember(fromApi);
  }

  if (!process.env.EDGE_CONFIG) return memoryUsers ?? [];
  const raw = await get(STORE_KEY).catch(() => null);
  return remember(parseUsers(raw));
}

export async function writeManagedUsers(users: ManagedDashboardUser[]): Promise<void> {
  const edgeConfigId = writeEdgeConfigId();
  const apiToken = writeToken();
  if (!edgeConfigId || !apiToken) {
    throw new Error(
      "Edge Config não está configurado para escrita. Defina EDGE_CONFIG_ID e EDGE_CONFIG_WRITE_TOKEN (e EDGE_CONFIG_TEAM_ID se o projeto for de time).",
    );
  }

  if (apiToken.includes("edge-config.vercel.com") || apiToken.startsWith("http")) {
    throw new Error(
      "EDGE_CONFIG_WRITE_TOKEN parece ser a connection string de leitura. Use um token criado em vercel.com/account/tokens (não o token da URL EDGE_CONFIG).",
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
      items: [{ operation: "upsert", key: STORE_KEY, value: users }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 403 && detail.includes("invalidToken")) {
      throw new Error(
        [
          "Token inválido ao gravar no Edge Config.",
          "Use um token de CONTA criado em https://vercel.com/account/tokens (escopo do time do projeto).",
          "Não use o token que aparece na connection string EDGE_CONFIG (esse só lê).",
          "Se o projeto for de time, defina também EDGE_CONFIG_TEAM_ID (Team Settings → General → Team ID).",
          detail,
        ].join(" "),
      );
    }
    throw new Error(`Falha ao gravar no Edge Config (HTTP ${response.status}). ${detail}`.trim());
  }

  // Write-through: próximas leituras neste processo já veem a senha/2FA novos.
  remember(users);
}
