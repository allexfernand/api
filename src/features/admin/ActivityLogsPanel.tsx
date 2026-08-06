"use client";

import styles from "./SettingsTab.module.css";
import { useActivityLogs } from "./hooks/useActivityLogs";
import type { LoginActivityEvent } from "../../contracts/activity-logs";

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function viaLabel(via: LoginActivityEvent["via"]) {
  return via === "totp" ? "Senha + 2FA" : "Senha";
}

function truncateUa(ua: string | null) {
  if (!ua) return "—";
  if (ua.length <= 72) return ua;
  return `${ua.slice(0, 69)}…`;
}

export function ActivityLogsPanel() {
  const { events, status, error, reload } = useActivityLogs(true);

  return (
    <div className={styles.logsPanel}>
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.panelUserName}>Últimos logins</div>
          <div className={styles.panelUserHint}>
            Registra usuário, horário e IP quando a sessão é emitida (após senha ou 2FA).
          </div>
        </div>
        <button type="button" className={styles.linkButton} onClick={reload} disabled={status === "loading"}>
          Atualizar
        </button>
      </div>

      {status === "loading" ? <p className={styles.subtitle}>Carregando logs…</p> : null}
      {status === "forbidden" ? <p className={styles.notice}>Acesso restrito a administradores.</p> : null}
      {status === "error" ? <p className={styles.notice}>{error ?? "Não foi possível carregar os logs."}</p> : null}

      {status === "ready" && events ? (
        events.length === 0 ? (
          <div className={styles.emptyPanel}>Nenhum login registrado ainda.</div>
        ) : (
          <div className={styles.logsTableWrap}>
            <table className={styles.logsTable}>
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Usuário</th>
                  <th scope="col">IP</th>
                  <th scope="col">Como</th>
                  <th scope="col">Navegador</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className={styles.logsWhen}>{formatWhen(event.at)}</td>
                    <td className={styles.logsUser}>{event.user}</td>
                    <td className={styles.logsIp}>{event.ip ?? "—"}</td>
                    <td>{viaLabel(event.via)}</td>
                    <td className={styles.logsUa} title={event.userAgent ?? undefined}>
                      {truncateUa(event.userAgent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
