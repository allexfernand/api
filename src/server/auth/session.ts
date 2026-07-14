// NOTE: marker "server-only" removido — Pages Router (pages/api/*) não suporta o import e derruba todos os endpoints com 500.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DashboardRole } from "../../contracts/common";

export const SESSION_COOKIE = "sanus_dashboard_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

type SessionPayload = {
  user: string;
  role: DashboardRole;
  exp: number;
};

function secret() {
  const value = process.env.DASHBOARD_SESSION_SECRET || process.env.DASHBOARD_AUTH_PASSWORD;
  if (!value) throw new Error("Segredo de sessão não configurado.");
  return value;
}

function signature(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionToken(user: string, role: DashboardRole) {
  const payload: SessionPayload = {
    user,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [encoded, receivedSignature] = token.split(".");
  if (!encoded || !receivedSignature) return null;
  const expectedSignature = signature(encoded);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.user || !["full", "mds"].includes(payload.role) || payload.exp <= Date.now() / 1000)
      return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSessionCookie(cookieHeader = "") {
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return token ? verifySessionToken(decodeURIComponent(token)) : null;
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function expiredSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
