// Níveis de acesso da Sinistralidade 360 (GOV-06):
//   1. Agregado empresarial — qualquer usuário autenticado com company scope.
//   2. Ranking individual mascarado — flag + permissão explícita por usuário.
//   3. Detalhe individual clínico — flag + permissão explícita por usuário.
// O perfil MDS nunca recebe acesso individual, independentemente das listas.
// Acesso administrativo genérico NÃO é autorização clínica implícita: as
// listas de usuários precisam ser configuradas explicitamente.

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
