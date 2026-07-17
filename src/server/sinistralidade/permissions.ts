// Níveis de acesso da Sinistralidade 360 (GOV-06):
//   1. Agregado empresarial — qualquer usuário autenticado com company scope.
//   2. Ranking individual mascarado — liberado por padrão; restrinja via lista.
//   3. Detalhe individual clínico — liberado por padrão; restrinja via lista.
// O perfil MDS nunca recebe acesso individual, independentemente das listas.
// Para restringir, configure SINISTRALIDADE_INDIVIDUAL_*_USERS com uma lista
// de usuários (ou "*").

import type { DashboardRole } from "../../contracts/common";
import { sinistralidadeFeatureFlags } from "./feature-flags";

declare const process: { env: Record<string, string | undefined> };

export type AuthIdentity = { user: string; role: DashboardRole };

function userList(name: string) {
  return [
    ...new Set(
      String(process.env[name] || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function userAllowed(auth: AuthIdentity, envName: string) {
  if (auth.role === "mds") return false;
  const allowed = userList(envName);
  // Sem lista configurada, o acesso é liberado por padrão (exceto MDS).
  // Configure a variável com uma lista de usuários (ou "*") para restringir.
  if (!allowed.length) return true;
  if (allowed.includes("*")) return true;
  return allowed.includes(auth.user.toLowerCase());
}

export type IndividualAccess = {
  ranking: boolean;
  detail: boolean;
};

export function individualAccessForAuth(auth: AuthIdentity): IndividualAccess {
  const flags = sinistralidadeFeatureFlags();
  return {
    ranking: flags.individualRanking && userAllowed(auth, "SINISTRALIDADE_INDIVIDUAL_RANKING_USERS"),
    detail: flags.individualDetail && userAllowed(auth, "SINISTRALIDADE_INDIVIDUAL_DETAIL_USERS"),
  };
}

export function assertIndividualRanking(auth: AuthIdentity) {
  if (!individualAccessForAuth(auth).ranking) {
    const error = new Error("Ranking individual não autorizado para este usuário.");
    Object.assign(error, { statusCode: 403 });
    throw error;
  }
}

export function assertIndividualDetail(auth: AuthIdentity) {
  if (!individualAccessForAuth(auth).detail) {
    const error = new Error("Detalhe individual não autorizado para este usuário.");
    Object.assign(error, { statusCode: 403 });
    throw error;
  }
}
