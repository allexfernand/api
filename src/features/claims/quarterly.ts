// Agregação trimestral derivada da série mensal. Não há consulta própria: a
// série `mensal` do payload já traz os três valores por mês.

import type { GoldPreview } from "../../contracts/gold-preview";

export type Trimestre = {
  trimestre: string;
  sinistro: number;
  itens: number;
  /** Média dos utilizantes mensais. Somar contaria a mesma pessoa em cada mês. */
  utilizantes_media_mensal: number;
  meses: number;
  parcial: boolean;
};

export function agruparTrimestres(mensal: GoldPreview["mensal"]): Trimestre[] {
  const buckets = new Map<string, { sinistro: number; itens: number; utilizantes: number[]; parcial: boolean }>();

  for (const linha of mensal) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(linha.mes);
    if (!match) continue;
    const chave = `${match[1]}-T${Math.ceil(Number(match[2]) / 3)}`;
    const atual = buckets.get(chave) ?? { sinistro: 0, itens: 0, utilizantes: [], parcial: false };
    atual.sinistro += linha.sinistro;
    atual.itens += linha.itens;
    atual.utilizantes.push(linha.utilizantes);
    atual.parcial = atual.parcial || linha.parcial;
    buckets.set(chave, atual);
  }

  return [...buckets.entries()]
    .map(([trimestre, v]) => ({
      trimestre,
      sinistro: Math.round(v.sinistro * 100) / 100,
      itens: v.itens,
      utilizantes_media_mensal: Math.round(v.utilizantes.reduce((s, n) => s + n, 0) / v.utilizantes.length),
      meses: v.utilizantes.length,
      // Trimestre sem os três meses, ou com algum mês parcial, não é comparável.
      parcial: v.parcial || v.utilizantes.length < 3,
    }))
    .sort((a, b) => a.trimestre.localeCompare(b.trimestre));
}
