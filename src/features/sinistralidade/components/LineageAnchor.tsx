"use client";

// Marca um bloco como tendo linhagem disponível enquanto o modo "Análise
// Databricks" está ligado. Com o modo desligado devolve os filhos sem
// envoltório extra e sem nenhum atributo: o DOM fica idêntico ao original.
//
// O alvo clicável é um <button> próprio, não o card inteiro. Envolver o card
// num role="button" aninharia controles interativos — o ChartCard já contém o
// botão "ver tabela" e o TopUsersTable contém selects de ordenação. Aninhar
// quebra a semântica ARIA e faria o clique nesses controles borbulhar e abrir
// a gaveta junto.

import type { ReactNode } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { useLineage } from "./LineageProvider";

export function LineageAnchor({
  lineageId,
  label,
  children,
}: {
  lineageId?: string;
  label: string;
  children: ReactNode;
}) {
  const { enabled, activeId, open } = useLineage();
  if (!enabled || !lineageId) return <>{children}</>;

  const active = activeId === lineageId;

  return (
    <div className={`${styles.lineageAnchor} ${active ? styles.lineageAnchorActive : ""}`}>
      {children}
      <button
        type="button"
        className={styles.lineageBadge}
        aria-label={`Ver linhagem Databricks de ${label}`}
        aria-expanded={active}
        onClick={() => open(lineageId)}
      >
        <i className="fa-solid fa-diagram-project" aria-hidden="true" />
        <span>linhagem</span>
      </button>
    </div>
  );
}
