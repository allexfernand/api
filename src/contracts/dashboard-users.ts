import { z } from "zod";
import { ALL_MENU_IDS, type MenuId } from "../dashboard/menu-catalog";
import { strongPasswordSchema } from "../lib/password-policy";
import { dashboardRoleSchema } from "./common";

export const menuIdSchema = z.enum(ALL_MENU_IDS as [MenuId, ...MenuId[]]);

// Registro persistido no Edge Config. `passwordHash` ausente/nulo indica um
// "overlay" de permissão sobre uma conta legada (sanus/mds, autenticada pelas
// env vars) — só sobrescreve papel/allowedMenus/isAdmin/groupScopes, nunca a
// senha.
export const managedDashboardUserSchema = z.object({
  user: z.string().trim().min(3).max(60),
  passwordHash: z.string().nullable(),
  role: dashboardRoleSchema,
  isAdmin: z.boolean(),
  allowedMenus: z.array(menuIdSchema).nullable(),
  // Grupos econômicos (nome da organização matriz) que o usuário pode
  // enxergar nos dados. null = sem restrição (vê todos, comportamento de
  // hoje); [] bloqueia todos os grupos. `.optional()` mantém compatível
  // registros salvos no Edge Config antes deste campo existir.
  groupScopes: z.array(z.string()).nullable().optional().transform((value) => value ?? null),
  // Parceiros (partner_broker_id) que o usuário pode enxergar. Mesma
  // semântica de groupScopes: null = sem restrição, [] bloqueia todos.
  partnerScopes: z.array(z.string()).nullable().optional().transform((value) => value ?? null),
  // Se true, o próximo login bem-sucedido não emite sessão normal — o
  // frontend pede troca de senha forte antes de liberar o dashboard.
  // `.optional()` + default false: registros antigos no Edge Config.
  mustChangePassword: z.boolean().optional().transform((value) => value ?? false),
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
  password: strongPasswordSchema,
  role: dashboardRoleSchema.default("mds"),
  isAdmin: z.boolean().default(false),
  allowedMenus: z.array(menuIdSchema).default([]),
  groupScopes: z.array(z.string()).nullable().default([]),
  partnerScopes: z.array(z.string()).nullable().default([]),
  mustChangePassword: z.boolean().default(true),
});
export type CreateManagedUserRequest = z.infer<typeof createManagedUserRequestSchema>;

export const updateManagedUserRequestSchema = z.object({
  role: dashboardRoleSchema.optional(),
  isAdmin: z.boolean().optional(),
  allowedMenus: z.array(menuIdSchema).nullable().optional(),
  groupScopes: z.array(z.string()).nullable().optional(),
  partnerScopes: z.array(z.string()).nullable().optional(),
  mustChangePassword: z.boolean().optional(),
  password: strongPasswordSchema.optional(),
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
  // Todos os grupos econômicos existentes hoje na base — sempre a lista
  // completa (sem aplicar o próprio recorte de quem está logado), para o
  // admin poder liberar qualquer um deles a qualquer usuário.
  economicGroups: z.array(z.string()),
  // Idem, para parceiros (partner_broker_id + nome de exibição).
  partners: z.array(z.object({ broker_id: z.string(), broker_name: z.string() })),
  // partner_broker_id → grupos econômicos (matrizes) ligados a ele. Usado
  // pra autoatribuir groupScopes ao marcar um parceiro na criação/edição.
  partnerGroupMap: z.record(z.string(), z.array(z.string())),
});
export type ManagedUsersListResponse = z.infer<typeof managedUsersListResponseSchema>;
