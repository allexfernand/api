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

export const totpVerifyRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Informe o código de 6 dígitos do autenticador."),
});

// Login pode devolver sessão normal, pedir troca de senha, ou pedir 2FA.
// `role` aceita string (não só o enum atual): o cookie já foi gravado no
// servidor antes do parse no cliente — rejeitar um papel novo (ex.: custom)
// derrubava o 2FA com JSON feio mesmo com sessão válida.
export const authResponseSchema = z.object({
  ok: z.literal(true),
  mustChangePassword: z.boolean().optional().default(false),
  needsTotpSetup: z.boolean().optional().default(false),
  needsTotp: z.boolean().optional().default(false),
  totpQrDataUrl: z.string().optional(),
  totpManualKey: z.string().optional(),
  role: z.union([dashboardRoleSchema, z.string()]).optional(),
  user: z.string().optional().default(""),
  // null = sem restrição configurada (comportamento legado por role/username).
  // Menus desconhecidos são ignorados (não derrubam o login).
  allowedMenus: z
    .array(z.string())
    .nullable()
    .optional()
    .default(null)
    .transform((menus) =>
      menus === null || menus === undefined
        ? null
        : (menus.filter((id) => menuIdSchema.safeParse(id).success) as z.infer<typeof menuIdSchema>[]),
    ),
  isAdmin: z.boolean().optional().default(false),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type TotpVerifyRequest = z.infer<typeof totpVerifyRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
