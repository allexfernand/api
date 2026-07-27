"use client";

// B4+ do fragmento legado (src/dashboard/fragments/gold-preview.html linhas
// 120-127) e public/scripts/gold-preview.js (bloco `topUti` de
// aplicarDadosReais): ranking dos maiores utilizantes por custo na janela.
//
// DADO SENSÍVEL: o servidor já mascara a chave (maskPerson, em
// src/server/routes/gold-preview.ts) — o que chega aqui é só
// "Beneficiário XXXXXXXX", nunca o person_key bruto nem CPF/nome. Este
// componente não tenta reconstruir, decodificar ou complementar essa chave
// de nenhuma forma; ela é exibida exatamente como veio. O aviso
// (`top_utilizantes.aviso`) é renderizado antes da lista, como no fragmento
// original, e o bloco continua colapsado por padrão (o fragmento também
// escondia esta tabela — display:none — até haver dados ao vivo).

import { useState } from "react";
import styles from "../ClaimsTab.module.css";
import type { GoldPreview } from "../../../contracts/gold-preview";
import { LineageAnchor } from "../../sinistralidade/components/LineageAnchor";

const formatadorInteiro = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const moedaCheia = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function TopUsers({ topUtilizantes }: { topUtilizantes: GoldPreview["top_utilizantes"] }) {
  const [expandido, setExpandido] = useState(false);

  return (
    <LineageAnchor lineageId="claims.top-users" label="Maiores utilizantes por uso">
      <article className={styles.card}>
        <div className={styles.sensitiveHeaderRow}>
          <div className={styles.cardTitle}>
            <h3>Maiores utilizantes por uso</h3>
            <p>Top {topUtilizantes.lista.length} beneficiários por custo na janela — identificação mascarada pelo servidor.</p>
          </div>
          <span className={styles.chipWarn}>DADO SENSÍVEL · USO INTERNO</span>
        </div>
        <p className={styles.sensitiveBanner} role="note">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          <span>{topUtilizantes.aviso}</span>
        </p>
        <button
          type="button"
          className={styles.collapseToggle}
          aria-expanded={expandido}
          onClick={() => setExpandido((valor) => !valor)}
        >
          <i className={`fa-solid ${expandido ? "fa-chevron-up" : "fa-chevron-down"}`} aria-hidden="true" />
          {expandido ? "Ocultar lista" : `Mostrar lista (${topUtilizantes.lista.length})`}
        </button>
        {expandido ? <TopUsersTable lista={topUtilizantes.lista} /> : null}
      </article>
    </LineageAnchor>
  );
}

function TopUsersTable({ lista }: { lista: GoldPreview["top_utilizantes"]["lista"] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col" className={styles.txt}>Código benef.</th>
          <th scope="col" className={styles.txt}>Faixa etária</th>
          <th scope="col" className={styles.txt}>Vínculo</th>
          <th scope="col" className={styles.txt}>Lotação</th>
          <th scope="col" className={styles.num}>Itens</th>
          <th scope="col" className={styles.num}>Internações</th>
          <th scope="col" className={styles.num}>Custo (R$)</th>
          <th scope="col" className={styles.num}>Share</th>
        </tr>
      </thead>
      <tbody>
        {lista.map((linha, index) => (
          <tr key={linha.codigo_usuario}>
            <td>{index + 1}</td>
            <td className={styles.txt}>
              {linha.codigo_usuario}
              {linha.id_corrompido ? (
                <span
                  className={styles.corruptedFlag}
                  title="ID corrompido na origem — pode agregar mais de uma pessoa; levar à CNU"
                >
                  {" "}⚠
                </span>
              ) : null}
            </td>
            <td className={styles.txt}>{linha.faixa_etaria}</td>
            <td className={styles.txt}>{linha.parentesco}</td>
            <td className={styles.txt}>{linha.lotacao}</td>
            <td className={styles.num}>{formatadorInteiro.format(linha.itens)}</td>
            <td className={styles.num}>{formatadorInteiro.format(linha.internacoes)}</td>
            <td className={styles.num}>{moedaCheia.format(linha.custo)}</td>
            <td className={styles.num}>{formatadorPercentual.format(linha.share)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
