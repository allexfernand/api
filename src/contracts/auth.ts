import { z } from "zod";
import { menuIdSchema } from "./dashboard-users";
import { strongPasswordSchema } from "../lib/password-policy";
import { dashboardRoleSchema } from "./common";

export const loginRequestSchema = z.object({
  user: z.string().trim().min(1),
  password: z.string().min(1),
});

export const changePasswordRequestSchema = z.object({
  user: z.string().trim().min(1),
  currentPassword: z.string().min(1),
  newPassword: strongPasswordSchema,
});

// Login pode devolver sessão normal OU pedir troca de senha (sem cookie).
export const authResponseSchema = z.object({
  ok: z.literal(true),
  mustChangePassword: z.boolean().optional().default(false),
  role: dashboardRoleSchema.optional(),
  user: z.string().optional().default(""),
  // null = sem restrição configurada (comportamento legado por role/username).
  allowedMenus: z.array(menuIdSchema).nullable().optional().default(null),
  isAdmin: z.boolean().optional().default(false),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
