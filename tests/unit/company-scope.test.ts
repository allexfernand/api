import { afterEach, describe, expect, it } from "vitest";
import { assertCompanyAccess, canAccessCompany, companyScopeSql, companyScopesForAuth } from "../../src/server/auth/company-scope";

const A = "a".repeat(64);
const B = "b".repeat(64);

afterEach(() => {
  delete process.env.DASHBOARD_AUTH_COMPANY_SCOPES;
  delete process.env.DASHBOARD_MDS_COMPANY_SCOPES;
});

describe("company scope", () => {
  it("keeps the authenticated full role usable in legacy deployments", () => {
    const auth = { user: "internal", role: "full" as const };
    expect(companyScopesForAuth(auth)).toEqual(["*"]);
    expect(canAccessCompany(auth, A)).toBe(true);
  });

  it("allows every valid company only for wildcard scope", () => {
    process.env.DASHBOARD_AUTH_COMPANY_SCOPES = "*";
    const auth = { user: "internal", role: "full" as const };
    expect(companyScopesForAuth(auth)).toEqual(["*"]);
    expect(canAccessCompany(auth, A)).toBe(true);
    expect(companyScopeSql(auth)).toBe("");
  });

  it("restricts access to configured companies", () => {
    process.env.DASHBOARD_AUTH_COMPANY_SCOPES = A;
    const auth = { user: "tenant", role: "full" as const };
    expect(canAccessCompany(auth, A)).toBe(true);
    expect(canAccessCompany(auth, B)).toBe(false);
    expect(companyScopeSql(auth)).toContain(A);
    expect(() => assertCompanyAccess(auth, B)).toThrow("Empresa não autorizada");
  });

  it("does not grant MDS access when no scope is configured", () => {
    const auth = { user: "mds", role: "mds" as const };
    expect(canAccessCompany(auth, A)).toBe(false);
    expect(companyScopeSql(auth)).toContain("1 = 0");
  });

  it("allows an explicit empty scope to deny the full role", () => {
    process.env.DASHBOARD_AUTH_COMPANY_SCOPES = "";
    const auth = { user: "internal", role: "full" as const };
    expect(companyScopesForAuth(auth)).toEqual([]);
    expect(canAccessCompany(auth, A)).toBe(false);
  });

  it("rejects malformed company keys", () => {
    process.env.DASHBOARD_AUTH_COMPANY_SCOPES = "*";
    expect(canAccessCompany({ user: "internal", role: "full" }, "AZUL")).toBe(false);
  });
});
