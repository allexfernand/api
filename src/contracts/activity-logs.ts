import { z } from "zod";

export const loginActivityViaSchema = z.enum(["password", "totp"]);
export type LoginActivityVia = z.infer<typeof loginActivityViaSchema>;

export const loginActivityEventSchema = z.object({
  id: z.string().min(1),
  user: z.string().min(1),
  at: z.string().min(1),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  via: loginActivityViaSchema,
});
export type LoginActivityEvent = z.infer<typeof loginActivityEventSchema>;

export const loginActivityListSchema = z.array(loginActivityEventSchema);

export const activityLogsResponseSchema = z.object({
  events: loginActivityListSchema,
});
export type ActivityLogsResponse = z.infer<typeof activityLogsResponseSchema>;
