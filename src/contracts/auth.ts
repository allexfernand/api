import { z } from "zod";
import { menuIdSchema } from "./dashboard-users";
import { dashboardRoleSchema } from "./common";

export const loginRequestSchema = z.object({
  user: z.string().trim().min(1),
  password: z.string().min(1),
});

export const authResponseSchema = z.object({
  ok: z.literal(true),
  role: dashboardRoleSchema,
  user: z.string().optional().default(""),
  // null = sem restrição configurada (comportamento legado por role/username).
  allowedMenus: z.array(menuIdSchema).nullable().optional().default(null),
  isAdmin: z.boolean().optional().default(false),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
