"use client";

// Estados reais por bloco: loading, atualizando, vazio, bloqueado por gate,
// sem permissão e erro com retry. Nada de dado fictício.

import type { ReactNode } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import type { ScopeResult } from "../hooks/useSinistralidadeScope";

export function BlockState<T>({
  result,
  emptyMessage,
  children,
}: {
  result: ScopeResult<T>;
  emptyMessage: string;
  children: (data: T) => ReactNode;
}) {
  if (result.status === "idle") return null;
  if (result.status === "loading") {
    return <div className={styles.blockLoading} role="status">Carregando este bloco…</div>;
  }
  if (result.status === "blocked") {
    return (
      <div className={styles.blockBlocked} role="status">
        <strong>Período bloqueado pelo gate de fechamento.</strong>
        <span>{result.envelope?.warnings.join(" ") || result.error || "Nenhum mês da janela está formalmente fechado."}</span>
      </div>
    );
  }
  if (result.status === "forbidden") {
    return (
      <div className={styles.blockBlocked} role="status">
        <strong>Bloco indisponível para o seu perfil ou ambiente.</strong>
        <span>{result.error}</span>
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div className={styles.blockError} role="alert">
        <strong>Não foi possível carregar este bloco.</strong>
        <span>{result.error}</span>
        <button type="button" onClick={result.retry}>Tentar novamente</button>
      </div>
    );
  }
  const isEmpty =
    result.data === null ||
    (Array.isArray(result.data) && result.data.length === 0);
  if (result.status === "success" && isEmpty) {
    return <div className={styles.blockEmpty}>{emptyMessage}</div>;
  }
  return (
    <div className={result.status === "refreshing" ? styles.blockRefreshing : undefined}>
      {result.status === "refreshing" && result.data === null ? (
        <div className={styles.blockLoading} role="status">Atualizando…</div>
      ) : result.data === null ? (
        <div className={styles.blockEmpty}>{emptyMessage}</div>
      ) : (
        children(result.data)
      )}
    </div>
  );
}
