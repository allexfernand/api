// Armazenamento dos usuários gerenciados (Configurações → permissão de menu)
// no Vercel Edge Config. Leitura usa o SDK oficial (rápida, decorre da env
// var EDGE_CONFIG que o Vercel injeta ao conectar o Edge Config ao projeto).
// Escrita não existe no SDK de leitura — vai direto na REST API do Vercel.
import { get } from "@vercel/edge-config";
import { managedDashboardUserSchema, type ManagedDashboardUser } from "../../contracts/dashboard-users";

const STORE_KEY = "dashboard_users";

export function isEdgeConfigReadable() {
  return Boolean(process.env.EDGE_CONFIG);
}

export function isEdgeConfigWritable() {
  return Boolean(process.env.EDGE_CONFIG_ID && process.env.VERCEL_API_TOKEN);
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
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const apiToken = process.env.VERCEL_API_TOKEN;
  if (!edgeConfigId || !apiToken) {
    throw new Error(
      "Edge Config não está configurado para escrita. Defina EDGE_CONFIG_ID e VERCEL_API_TOKEN nas env vars da Vercel.",
    );
  }
  const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
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
    throw new Error(`Falha ao gravar no Edge Config (HTTP ${response.status}). ${detail}`.trim());
  }
}
