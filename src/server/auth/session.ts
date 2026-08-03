// NOTE: marker "server-only" removido — Pages Router (pages/api/*) não suporta o import e derruba todos os endpoints com 500.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DashboardRole } from "../../contracts/common";
import { isMenuId, type MenuId } from "../../dashboard/menu-catalog";

export const SESSION_COOKIE = "sanus_dashboard_session";
export const MFA_PENDING_COOKIE = "sanus_dashboard_mfa";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MFA_PENDING_TTL_SECONDS = 10 * 60;

type SessionPayload = {
  user: string;
  role: DashboardRole;
  exp: number;
  // `null`/ausente = sem restrição configurada em Configurações (mantém o
  // comportamento legado baseado em role/username que já existia). Sessões
  // assinadas antes desta mudança não têm este campo — tratadas como null.
  allowedMenus?: MenuId[] | null;
  isAdmin?: boolean;
  // groupScopes/partnerScopes NÃO vão mais no cookie: com "selecionar todos"
  // o payload estoura o limite de ~4KB do browser, o cookie é descartado e o
  // login "pisca" com 401. Escopos vêm do Edge Config a cada request.
};

export type MfaPendingPayload = {
  user: string;
  // setup = mostrar QR e confirmar 1º código; verify = só pedir o código
  stage: "setup" | "verify";
  exp: number;
};

function secret() {
  const value = process.env.DASHBOARD_SESSION_SECRET;
  if (!value) throw new Error("DASHBOARD_SESSION_SECRET não configurado.");
  return value;
}

function signature(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function signPayload(payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

function verifySignedPayload<T extends { exp: number }>(token: string): T | null {
  const [encoded, receivedSignature] = token.split(".");
  if (!encoded || !receivedSignature) return null;
  const expectedSignature = signature(encoded);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
    if (!payload || typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(
  user: string,
  role: DashboardRole,
  extra?: {
    allowedMenus?: MenuId[] | null;
    isAdmin?: boolean;
  },
) {
  const payload: SessionPayload = {
    user,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    allowedMenus: extra?.allowedMenus ?? null,
    isAdmin: extra?.isAdmin ?? false,
  };
  return signPayload(payload);
}

export function verifySessionToken(token: string): SessionPayload | null {
  const payload = verifySignedPayload<SessionPayload>(token);
  if (!payload?.user || !["full", "mds"].includes(payload.role)) return null;
  const allowedMenus = Array.isArray(payload.allowedMenus)
    ? payload.allowedMenus.filter((id): id is MenuId => typeof id === "string" && isMenuId(id))
    : null;
  return { ...payload, allowedMenus, isAdmin: Boolean(payload.isAdmin) };
}

function readCookie(cookieHeader: string, name: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function readSessionCookie(cookieHeader = "") {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  return token ? verifySessionToken(decodeURIComponent(token)) : null;
}

function cookieFlags(maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(SESSION_TTL_SECONDS)}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; ${cookieFlags(0)}`;
}

export function createMfaPendingToken(user: string, stage: "setup" | "verify") {
  const payload: MfaPendingPayload = {
    user,
    stage,
    exp: Math.floor(Date.now() / 1000) + MFA_PENDING_TTL_SECONDS,
  };
  return signPayload(payload);
}

export function verifyMfaPendingToken(token: string): MfaPendingPayload | null {
  const payload = verifySignedPayload<MfaPendingPayload>(token);
  if (!payload?.user || (payload.stage !== "setup" && payload.stage !== "verify")) return null;
  return payload;
}

export function readMfaPendingCookie(cookieHeader = "") {
  const token = readCookie(cookieHeader, MFA_PENDING_COOKIE);
  return token ? verifyMfaPendingToken(decodeURIComponent(token)) : null;
}

export function mfaPendingCookie(token: string) {
  return `${MFA_PENDING_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(MFA_PENDING_TTL_SECONDS)}`;
}

export function expiredMfaPendingCookie() {
  return `${MFA_PENDING_COOKIE}=; ${cookieFlags(0)}`;
}
