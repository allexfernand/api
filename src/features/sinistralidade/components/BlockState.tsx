"use client";

// Estados reais por bloco: loading, atualizando, vazio, bloqueado por gate,
// sem permissão e erro com retry. Nada de dado fictício.
//
// `lineageId`/`label` são opcionais e só existem para abrir linhagem Databricks
// nos estados que não chegam a `children(data)` — bloqueado, sem permissão,
// erro e vazio. O `LineageAnchor` já devolve os filhos sem envoltório quando
// `lineageId` está ausente ou o modo está desligado, então envolver
// incondicionalmente aqui não altera o DOM dos chamadores que não passam esses
// props (ex.: `UserDetailDrawer`). Propositalmente **não** envolve `loading`
// (selo sobre esqueleto transitório é ruído) nem o caminho de sucesso (o
// `ChartCard`/`LineageAnchor` já vive dentro de `children`, e envolver de novo
// duplicaria o selo no mesmo bloco).

import type { ReactNode } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import type { ScopeResult } from "../hooks/useSinistralidadeScope";
import { LineageAnchor } from "./LineageAnchor";

export function BlockState<T>({
  result,
  emptyMessage,
  lineageId,
  label,
  children,
}: {
  result: ScopeResult<T>;
  emptyMessage: string;
  lineageId?: string;
  label?: string;
  children: (data: T) => ReactNode;
}) {
  if (result.status === "idle") return null;
  if (result.status === "loading") {
    return <div className={styles.blockLoading} role="status">Carregando este bloco…</div>;
  }
  if (result.status === "blocked") {
    return (
      <LineageAnchor lineageId={lineageId} label={label ?? ""}>
        <div className={styles.blockBlocked} role="status">
          <strong>Período bloqueado pelo gate de fechamento.</strong>
          <span>{result.envelope?.warnings.join(" ") || result.error || "Nenhum mês da janela está formalmente fechado."}</span>
        </div>
      </LineageAnchor>
    );
  }
  if (result.status === "forbidden") {
    return (
      <LineageAnchor lineageId={lineageId} label={label ?? ""}>
        <div className={styles.blockBlocked} role="status">
          <strong>Bloco indisponível para o seu perfil ou ambiente.</strong>
          <span>{result.error}</span>
        </div>
      </LineageAnchor>
    );
  }
  if (result.status === "error") {
    return (
      <LineageAnchor lineageId={lineageId} label={label ?? ""}>
        <div className={styles.blockError} role="alert">
          <strong>Não foi possível carregar este bloco.</strong>
          <span>{result.error}</span>
          <button type="button" onClick={result.retry}>Tentar novamente</button>
        </div>
      </LineageAnchor>
    );
  }
  const isEmpty =
    result.data === null ||
    (Array.isArray(result.data) && result.data.length === 0);
  if (result.status === "success" && isEmpty) {
    return (
      <LineageAnchor lineageId={lineageId} label={label ?? ""}>
        <div className={styles.blockEmpty}>{emptyMessage}</div>
      </LineageAnchor>
    );
  }
  return (
    <div className={result.status === "refreshing" ? styles.blockRefreshing : undefined}>
      {result.status === "refreshing" && result.data === null ? (
        <div className={styles.blockLoading} role="status">Atualizando…</div>
      ) : result.data === null ? (
        <LineageAnchor lineageId={lineageId} label={label ?? ""}>
          <div className={styles.blockEmpty}>{emptyMessage}</div>
        </LineageAnchor>
      ) : (
        children(result.data)
      )}
    </div>
  );
}
