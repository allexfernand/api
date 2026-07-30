declare const process: { env: Record<string, string | undefined> };
declare const Buffer: { from(value: string, encoding: string): { toString(encoding: string): string } };
import { validateDashboardCredentials } from "../src/server/auth/credentials";
import { readSessionCookie } from "../src/server/auth/session";
import type { MenuId } from "../src/dashboard/menu-catalog";

type AuthRequest = object;

type AuthRequestWithHeaders = {
  headers?: Record<string, string | string[] | undefined>;
};

type AuthResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
};

export const MDS_PARTNER_SCOPE = "__SANUS_MDS_PARTNER__";

function headerValue(req: AuthRequest, name: string) {
  const headers = (req as AuthRequestWithHeaders).headers || {};
  const direct = headers[name] || headers[name.toLowerCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  return value ? String(value) : "";
}

function decodeBasicAuth(value: string) {
  const match = value.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function getDashboardAuth(req: AuthRequest) {
  const session = readSessionCookie(headerValue(req, "cookie"));
  if (session)
    return {
      user: session.user,
      role: session.role,
      allowedMenus: session.allowedMenus ?? null,
      isAdmin: Boolean(session.isAdmin),
    };
  const credentials = decodeBasicAuth(headerValue(req, "authorization"));
  const legacy = credentials ? validateDashboardCredentials(credentials.user, credentials.password) : null;
  // Fallback via Authorization Basic (sem passar por /api/auth/login) nunca
  // teve acesso ao overlay do Edge Config — mantém o comportamento legado
  // (sem restrição de menu, admin só quando o usuário literal é "sanus").
  return legacy
    ? { ...legacy, allowedMenus: null, isAdmin: legacy.user.trim().toLowerCase() === "sanus" }
    : null;
}

export function hasMenuAccess(
  auth: { allowedMenus?: MenuId[] | null } | null,
  requiredMenus: MenuId[],
): boolean {
  if (!auth) return false;
  if (!auth.allowedMenus) return true;
  return auth.allowedMenus.some((id) => requiredMenus.includes(id));
}

export function requireMenuAccess(req: AuthRequest, res: AuthResponse, requiredMenus: MenuId[]) {
  if (hasMenuAccess(getDashboardAuth(req), requiredMenus)) return true;
  res.status(403).json({ error: "Usuário sem acesso a este menu." });
  return false;
}

export function requireAdminAuth(req: AuthRequest, res: AuthResponse) {
  if (getDashboardAuth(req)?.isAdmin) return true;
  res.status(403).json({ error: "Acesso restrito a administradores." });
  return false;
}

export function requireBasicAuth(req: AuthRequest, res: AuthResponse) {
  const expectedUser = process.env.DASHBOARD_AUTH_USER;
  const expectedPassword = process.env.DASHBOARD_AUTH_PASSWORD;
  const mdsUser = process.env.DASHBOARD_MDS_AUTH_USER;
  const mdsPassword = process.env.DASHBOARD_MDS_AUTH_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    res.status(500).json({ error: "Autenticação não configurada." });
    return false;
  }
  if ((mdsUser && !mdsPassword) || (!mdsUser && mdsPassword)) {
    res.status(500).json({ error: "Autenticação MDS incompleta." });
    return false;
  }

  if (getDashboardAuth(req)) {
    return true;
  }

  res.status(401).json({ error: "Usuário ou senha inválidos." });
  return false;
}

export function isMdsAuth(req: AuthRequest) {
  return getDashboardAuth(req)?.role === "mds";
}

export function scopedPartnerBrokerId(req: AuthRequest, requestedPartnerBrokerId: unknown) {
  return isMdsAuth(req) ? MDS_PARTNER_SCOPE : requestedPartnerBrokerId;
}

export function rejectMdsAuth(req: AuthRequest, res: AuthResponse) {
  if (!isMdsAuth(req)) return false;
  res.status(403).json({ error: "Usuário MDS restrito ao dashboard Petit Comitê MDS." });
  return true;
}
