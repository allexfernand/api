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
import { useLineageOptional } from "./LineageProvider";

export function LineageAnchor({
  lineageId,
  label,
  children,
}: {
  lineageId?: string;
  label: string;
  children: ReactNode;
}) {
  // useLineageOptional (não useLineage) de propósito: ChartCard e Kpi são
  // componentes de apresentação usados em vários pontos da árvore e podem
  // renderizar antes de qualquer LineageProvider estar montado acima deles.
  // Sem provider não há para onde mandar o clique, então a âncora não tem
  // nada a oferecer — a resposta certa é devolver os filhos sem badge, igual
  // ao caminho "modo desligado", nunca lançar. Não troque isto de volta para
  // useLineage(): isso derrubaria qualquer card antes do provider existir.
  const lineage = useLineageOptional();
  if (!lineage?.enabled || !lineageId) return <>{children}</>;

  const { activeId, open } = lineage;
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
