declare const process: { env: Record<string, string | undefined> };
declare const Buffer: { from(value: string, encoding: string): { toString(encoding: string): string } };

type AuthRequest = {
  headers?: Record<string, string | string[] | undefined>;
};

type AuthResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
};

function headerValue(req: AuthRequest, name: string) {
  const headers = req.headers || {};
  const direct = headers[name] || headers[name.toLowerCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  return value ? String(value) : "";
}

function decodeBasicAuth(value: string) {
  const match = value.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function requireBasicAuth(req: AuthRequest, res: AuthResponse) {
  const expectedUser = process.env.DASHBOARD_AUTH_USER;
  const expectedPassword = process.env.DASHBOARD_AUTH_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    res.status(500).json({ error: "Autenticação não configurada." });
    return false;
  }

  const credentials = decodeBasicAuth(headerValue(req, "authorization"));
  if (credentials?.user === expectedUser && credentials.password === expectedPassword) {
    return true;
  }

  res.status(401).json({ error: "Usuário ou senha inválidos." });
  return false;
}
