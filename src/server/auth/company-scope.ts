import type { DashboardRole } from "../../contracts/common";

type AuthIdentity = { user: string; role: DashboardRole };

const COMPANY_KEY = /^[a-f0-9]{64}$/i;

function parseScopes(value: string | undefined) {
  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
}

export function companyScopesForAuth(auth: AuthIdentity) {
  const raw = auth.role === "mds"
    ? process.env.DASHBOARD_MDS_COMPANY_SCOPES
    : process.env.DASHBOARD_AUTH_COMPANY_SCOPES;
  // O papel full representa o administrador interno já autenticado. Quando a
  // variável ainda não existe (deploy legado), mantém o acesso administrativo;
  // uma variável explicitamente vazia continua negando tudo.
  if (auth.role === "full" || auth.role === "custom") {
    if (raw === undefined) return ["*"];
  }
  const configured = parseScopes(raw);
  if (configured.includes("*")) return ["*"];
  return configured.filter((scope) => COMPANY_KEY.test(scope));
}

export function canAccessCompany(auth: AuthIdentity, companyKey: string) {
  if (!COMPANY_KEY.test(companyKey)) return false;
  const scopes = companyScopesForAuth(auth);
  return scopes.includes("*") || scopes.includes(companyKey);
}

export function companyScopeSql(auth: AuthIdentity, column = "company_key") {
  const scopes = companyScopesForAuth(auth);
  if (scopes.includes("*")) return "";
  if (!scopes.length) return " AND 1 = 0";
  return ` AND ${column} IN (${scopes.map((scope) => `'${scope}'`).join(",")})`;
}

export function assertCompanyAccess(auth: AuthIdentity, companyKey: string) {
  if (!canAccessCompany(auth, companyKey)) {
    const error = new Error("Empresa não autorizada para este usuário.");
    Object.assign(error, { statusCode: 403 });
    throw error;
  }
  return companyKey.toLowerCase();
}
