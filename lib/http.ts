type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

export const CACHE_STABLE = "private, max-age=60, stale-while-revalidate=120";

export function setApiCors(res: HeaderResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function setStableCache(res: HeaderResponse) {
  res.setHeader("Cache-Control", CACHE_STABLE);
}
