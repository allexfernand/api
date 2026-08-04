import { describe, expect, it } from "vitest";
import { authResponseSchema } from "../../src/contracts/auth";
import { managedUsersListResponseSchema } from "../../src/contracts/dashboard-users";
import { MENU_SECTIONS } from "../../src/dashboard/menu-catalog";

describe("authResponseSchema after custom role", () => {
  it("parses full with menus", () => {
    const r = authResponseSchema.safeParse({
      ok: true,
      role: "full",
      user: "inter",
      allowedMenus: ["demografica", "visao-parceiros", "agendamentos", "sessoes"],
      isAdmin: false,
    });
    expect(r.success).toBe(true);
  });

  it("parses custom role without blocking 2FA/login", () => {
    const r = authResponseSchema.safeParse({
      ok: true,
      role: "custom",
      user: "elane.andrade@sanus.tech",
      allowedMenus: ["demografica"],
      isAdmin: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.role).toBe("custom");
  });

  it("parses null menus", () => {
    const r = authResponseSchema.safeParse({
      ok: true,
      role: "full",
      user: "henrique",
      allowedMenus: null,
      isAdmin: false,
    });
    expect(r.success).toBe(true);
  });

  it("drops unknown menu ids instead of failing", () => {
    const r = authResponseSchema.safeParse({
      ok: true,
      role: "custom",
      user: "x",
      allowedMenus: ["demografica", "menu-inexistente"],
      isAdmin: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.allowedMenus).toEqual(["demografica"]);
  });

  it("parses admin list with custom role in catalog", () => {
    const r = managedUsersListResponseSchema.safeParse({
      users: [
        {
          user: "inter",
          role: "full",
          isAdmin: false,
          allowedMenus: ["demografica", "visao-parceiros", "agendamentos", "sessoes"],
          groupScopes: null,
          partnerScopes: null,
          mustChangePassword: false,
          totpEnabled: false,
          totpVerified: false,
          createdAt: "2026-08-03T20:07:45.258Z",
          updatedAt: "2026-08-03T21:01:20.928Z",
          isLegacy: false,
          hasCustomPassword: true,
        },
      ],
      menuCatalog: MENU_SECTIONS,
      economicGroups: ["A"],
      partners: [{ broker_id: "1", broker_name: "p" }],
      partnerGroupMap: {},
    });
    expect(r.success).toBe(true);
  });
});
