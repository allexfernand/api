declare const process: { env: Record<string, string | undefined> };

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

// Respostas trafegam PII (CPF, diagnósticos), então não podem ser cacheadas
// pelo navegador nem por proxies intermediários.
export const CACHE_STABLE = "private, no-store, max-age=0";

export function allowedOrigins(): string[] {
  return (process.env.DASHBOARD_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// O CORS (cabeçalho Access-Control-Allow-Origin) é resolvido de forma central
// no adaptador de rota, que tem acesso à origem da requisição. Aqui apenas
// declaramos métodos/headers permitidos, sem nunca emitir o wildcard "*".
export function setApiCors(res: HeaderResponse) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function setStableCache(res: HeaderResponse) {
  res.setHeader("Cache-Control", CACHE_STABLE);
}
