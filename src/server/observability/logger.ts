// NOTE: marker "server-only" removido — Pages Router (pages/api/*) não suporta o import e derruba todos os endpoints com 500.

type LogContext = Record<string, unknown>;

function write(level: "info" | "warn" | "error", event: string, context: LogContext = {}) {
  const payload = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...context });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export const logger = {
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext) => write("warn", event, context),
  error: (event: string, context?: LogContext) => write("error", event, context),
};
