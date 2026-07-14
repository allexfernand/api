import { z } from "zod";
import { dashboardRoleSchema } from "./common";

export const loginRequestSchema = z.object({
  user: z.string().trim().min(1),
  password: z.string().min(1),
});

export const authResponseSchema = z.object({
  ok: z.literal(true),
  role: dashboardRoleSchema,
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
