import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionToken,
  readSessionCookie,
  SESSION_COOKIE,
  verifySessionToken,
} from "../../src/server/auth/session";

describe("dashboard session", () => {
  beforeEach(() => {
    process.env.DASHBOARD_SESSION_SECRET = "test-secret-with-at-least-thirty-two-characters";
  });

  it("assina, valida e lê o cookie", () => {
    const token = createSessionToken("usuario", "full");
    expect(verifySessionToken(token)?.role).toBe("full");
    expect(readSessionCookie(`${SESSION_COOKIE}=${encodeURIComponent(token)}`)?.user).toBe("usuario");
    expect(verifySessionToken(`${token}corrompido`)).toBeNull();
  });
});
