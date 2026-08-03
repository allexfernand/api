// Armazenamento dos usuários gerenciados (Configurações → permissão de menu)
// no Vercel Edge Config. Leitura usa o SDK oficial (rápida, decorre da env
// var EDGE_CONFIG que o Vercel injeta ao conectar o Edge Config ao projeto).
// Escrita não existe no SDK de leitura — vai direto na REST API do Vercel.
import { get } from "@vercel/edge-config";
import { managedDashboardUserSchema, type ManagedDashboardUser } from "../../contracts/dashboard-users";

const STORE_KEY = "dashboard_users";

function trimEnv(name: string) {
  const value = process.env[name];
  return value ? value.trim() : "";
}

// Preferimos nomes sem prefixo VERCEL_ (menos confusão com vars de sistema).
// Mantemos fallback nos nomes antigos pra não quebrar quem já configurou.
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
  return Boolean(process.env.EDGE_CONFIG);
}

export function isEdgeConfigWritable() {
  return Boolean(writeEdgeConfigId() && writeToken());
}

export async function readManagedUsers(): Promise<ManagedDashboardUser[]> {
  if (!isEdgeConfigReadable()) return [];
  const raw = await get(STORE_KEY).catch(() => null);
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((entry) => managedDashboardUserSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
  return parsed;
}

export async function writeManagedUsers(users: ManagedDashboardUser[]): Promise<void> {
  const edgeConfigId = writeEdgeConfigId();
  const apiToken = writeToken();
  if (!edgeConfigId || !apiToken) {
    throw new Error(
      "Edge Config não está configurado para escrita. Defina EDGE_CONFIG_ID e EDGE_CONFIG_WRITE_TOKEN (e EDGE_CONFIG_TEAM_ID se o projeto for de time).",
    );
  }

  // Sintoma clássico: colar o token de LEITURA da connection string EDGE_CONFIG
  // (ou a URL inteira) no lugar do token de conta criado em Account → Tokens.
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
}
