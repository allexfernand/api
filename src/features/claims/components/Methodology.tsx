"use client";

// Card de metodologia do rodapé — transcrito de
// src/dashboard/fragments/gold-preview.html linha 216
// (id="pg-metodologia-card"). Texto estático por natureza: não representa
// nenhum número da gold, por isso não recebe lineageId (ver brief da Task 7).
//
// Uma frase do fragmento original foi adaptada, não copiada ao pé da letra:
// a pendência "alinhar definição de custo total (copart) com a aba Análise
// Sinistro" só fazia sentido enquanto esta tela era um preview separado da
// aba Análise Sinistro antiga. Com a consolidação (Task 7 em diante, este
// preview VIRA a aba Análise Sinistro), manter a frase citaria uma aba que
// deixou de existir como algo externo a esta própria tela.

import styles from "../ClaimsTab.module.css";

export function Methodology() {
  return (
    <article className={`${styles.card} ${styles.methodologyCard}`}>
      <p className={styles.methodologyText}>
        <strong>Regras de leitura: </strong>
        janela de tendência 2025-01+ nas séries mensal/competência/composição por evento; lotações, prestadores,
        internação e saúde mental usam desde 2024-01 (2024 é rampa de implantação) · exclui registros com data
        suspeita · dado individual (Top utilizantes) aparece só com acesso interno autorizado, sempre mascarado ·
        sinistro bruto por data do atendimento — não é taxa de sinistralidade nem loss ratio, pois a base não tem o
        prêmio mensal.
      </p>
    </article>
  );
}
