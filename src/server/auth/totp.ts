// TOTP (RFC 6238) para autenticador 2 fatores — Google Authenticator, Authy, etc.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Sanus Dashboard";

function sessionSecret() {
  const value = process.env.DASHBOARD_SESSION_SECRET;
  if (!value) throw new Error("DASHBOARD_SESSION_SECRET não configurado.");
  return value;
}

function encryptionKey() {
  return createHash("sha256").update(`totp:${sessionSecret()}`).digest();
}

/** Gera um secret base32 novo (não criptografado). */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** Criptografa o secret base32 antes de persistir no Edge Config. */
export function encryptTotpSecret(plainBase32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptTotpSecret(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    // Compat: se alguém gravou base32 cru (sem prefixo), usa direto.
    if (/^[A-Z2-7]+=*$/i.test(stored)) return stored;
    throw new Error("Secret TOTP inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

function totpFor(user: string, plainBase32: string) {
  return new TOTP({
    issuer: ISSUER,
    label: user,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(plainBase32),
  });
}

export function buildOtpauthUrl(user: string, plainBase32: string) {
  return totpFor(user, plainBase32).toString();
}

export async function buildTotpQrDataUrl(user: string, plainBase32: string) {
  const uri = buildOtpauthUrl(user, plainBase32);
  return QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
}

/** Valida código de 6 dígitos com janela ±1 período (30s). */
export function verifyTotpCode(plainBase32: string, code: string, user = "user") {
  const normalized = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const delta = totpFor(user, plainBase32).validate({ token: normalized, window: 1 });
  return delta !== null;
}
