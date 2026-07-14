// NOTE: marker "server-only" removido — Pages Router (pages/api/*) não suporta o import e derruba todos os endpoints com 500.
import { z } from "zod";

const serverEnvSchema = z.object({
  DATABRICKS_HOST: z.string().url(),
  DATABRICKS_TOKEN: z.string().min(1),
  DATABRICKS_WAREHOUSE_ID: z.string().min(1).optional(),
  DASHBOARD_AUTH_USER: z.string().min(1),
  DASHBOARD_AUTH_PASSWORD: z.string().min(1),
  DASHBOARD_MDS_AUTH_USER: z.string().min(1).optional(),
  DASHBOARD_MDS_AUTH_PASSWORD: z.string().min(1).optional(),
  DASHBOARD_SESSION_SECRET: z.string().min(32).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Variaveis de ambiente invalidas ou ausentes: ${fields}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
