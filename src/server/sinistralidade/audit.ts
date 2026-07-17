// Auditoria de acesso individual. Registrada somente após autorização,
// sempre com a pessoa mascarada — nunca CPF, nome ou chave completa em log.

import { logger } from "../observability/logger";

export function maskPersonKey(personKey: string) {
  return `pessoa:${personKey.slice(0, 8)}…`;
}

export function auditIndividualAccess(entry: {
  user: string;
  role: string;
  companyKey: string;
  personKey: string;
  scope: string;
  endMonth: string | null;
  windowMonths: number | null;
  /** "success" (padrão) ou "not_found" — sondagens malsucedidas também deixam rastro. */
  outcome?: "success" | "not_found";
}) {
  logger.info("sinistralidade.individual_access", {
    user: entry.user,
    role: entry.role,
    company: entry.companyKey.slice(0, 8),
    person: maskPersonKey(entry.personKey),
    scope: entry.scope,
    endMonth: entry.endMonth,
    windowMonths: entry.windowMonths,
    outcome: entry.outcome ?? "success",
    accessedAt: new Date().toISOString(),
  });
}
