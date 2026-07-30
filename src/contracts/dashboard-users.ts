import { z } from "zod";
import { ALL_MENU_IDS, type MenuId } from "../dashboard/menu-catalog";
import { dashboardRoleSchema } from "./common";

export const menuIdSchema = z.enum(ALL_MENU_IDS as [MenuId, ...MenuId[]]);

// Registro persistido no Edge Config. `passwordHash` ausente/nulo indica um
// "overlay" de permissão sobre uma conta legada (sanus/mds, autenticada pelas
// env vars) — só sobrescreve papel/allowedMenus/isAdmin, nunca a senha.
export const managedDashboardUserSchema = z.object({
  user: z.string().trim().min(3).max(60),
  passwordHash: z.string().nullable(),
  role: dashboardRoleSchema,
  isAdmin: z.boolean(),
  allowedMenus: z.array(menuIdSchema).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ManagedDashboardUser = z.infer<typeof managedDashboardUserSchema>;

export const managedDashboardUserPublicSchema = managedDashboardUserSchema.omit({ passwordHash: true }).extend({
  isLegacy: z.boolean(),
  hasCustomPassword: z.boolean(),
});
export type ManagedDashboardUserPublic = z.infer<typeof managedDashboardUserPublicSchema>;

export const createManagedUserRequestSchema = z.object({
  user: z.string().trim().min(3).max(60),
  password: z.string().min(8).max(200),
  role: dashboardRoleSchema.default("mds"),
  isAdmin: z.boolean().default(false),
  allowedMenus: z.array(menuIdSchema).default([]),
});
export type CreateManagedUserRequest = z.infer<typeof createManagedUserRequestSchema>;

export const updateManagedUserRequestSchema = z.object({
  role: dashboardRoleSchema.optional(),
  isAdmin: z.boolean().optional(),
  allowedMenus: z.array(menuIdSchema).nullable().optional(),
  password: z.string().min(8).max(200).optional(),
});
export type UpdateManagedUserRequest = z.infer<typeof updateManagedUserRequestSchema>;

export const managedUsersListResponseSchema = z.object({
  users: z.array(managedDashboardUserPublicSchema),
  menuCatalog: z.array(
    z.object({
      label: z.string(),
      items: z.array(z.object({ id: menuIdSchema, label: z.string(), icon: z.string() })),
    }),
  ),
});
export type ManagedUsersListResponse = z.infer<typeof managedUsersListResponseSchema>;
