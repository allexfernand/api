import { describe, expect, it } from "vitest";
import { goldPreviewSchema } from "../../src/contracts/gold-preview";

const minimo = {
  filtros: {
    aplicados: {},
    disponiveis: {},
    notas: ["cidade/estado: snapshot de elegibilidade da família do titular; cobertura parcial da ponte familiar"],
  },
  fonte: {
    gold: "gold_sinistro_evento_v2",
    contract_version: "1.2.0",
    delta_version: 44,
    delta_timestamp: "2026-07-07T00:00:00Z",
    gerado_em: "2026-07-26T00:00:00.000Z",
    filtro: "NOT flag_data_suspeita",
    role: "full",
  },
  mensal: [{ mes: "2026-01", utilizantes: 10, itens: 20, sinistro: 1000, parcial: false, estado: "closed" as const }],
  competencia: [{ mes: "2026-01", sinistro: 900, servicos: 18, linhas: 20 }],
  // Mapa mês -> tipo de evento -> sinistro, como o handler realmente monta (não uma lista).
  composicao_tipo_evento: { "2026-01": { Consulta: 1000, "Internação": 500 } },
  kpis: {
    periodo: "closed",
    ultimo_mes_fechado: "2026-01",
    sinistro_ultimo_mes_fechado: 1000,
    utilizantes_ultimo_mes_fechado: 10,
    janela_12m: ["2026-01"],
    sinistro_12m: 1000,
    utilizantes_12m: 10,
    custo_por_utilizante_12m: 100,
    reembolso_share_12m: 3.3,
  },
  lotacoes: [],
  prestadores: { total_prestadores: 0, sinistro_total: 0, top: [] },
  concentracao: { janela: ["2026-01"], utilizantes: 10, top1_pessoas: 1, top1_share: 30, top5_share: 50 },
  internacao: { por_agrupamento: [], linhas_assistenciais: 0, internacoes_distintas: 0, beneficiarios_unicos: 0, dias_internados: 0, custo_medio: 0, duracao_mediana_dias: 0, duracao_p90_dias: 0, por_saude_mental: [] },
  saude_mental: { share_flag: null, custo: 0, beneficiarios: 0, servicos: 0, reembolso_custo: 0, reembolso_share: null, por_tema: [] },
  impacto_sanus: { metodologia: "x", pre: null, pos: null, trimestres_utilizantes: [] },
  comparacao_madura: { metodologia: "x", before_meses: [], after_meses: [], familias_comuns: 0 },
  jornada_sanus: { janela: [], metodologia: "x", servicos: [], proximidade: {} },
  top_utilizantes: {
    janela: [],
    aviso: "x",
    lista: [{
      codigo_usuario: "Beneficiário abcd1234",
      id_corrompido: false,
      faixa_etaria: "30-39",
      parentesco: "Titular",
      lotacao: "Matriz",
      custo: 5000,
      itens: 12,
      internacoes: 0,
      share: 1.2,
    }],
  },
  carteira: { operadoras: [], empresas: [], beneficiarios_total: 0 },
};

describe("contrato do payload gold-preview", () => {
  it("aceita um payload completo", () => {
    expect(goldPreviewSchema.parse(minimo).competencia).toHaveLength(1);
  });

  it("aceita indicadores calculados em período observado", () => {
    const previewObservado = {
      ...minimo,
      kpis: { ...minimo.kpis, periodo: "observed" as const },
    };

    expect(goldPreviewSchema.parse(previewObservado).kpis.periodo).toBe("observed");
  });

  it.each(["closed", "partial", "unknown"] as const)("aceita mês com gate %s", (estado) => {
    const preview = {
      ...minimo,
      mensal: [{ ...minimo.mensal[0], estado, parcial: estado !== "closed" }],
    };

    expect(goldPreviewSchema.parse(preview).mensal[0]?.estado).toBe(estado);
  });

  it("exige a série de competência", () => {
    const sem: Record<string, unknown> = { ...minimo };
    delete sem.competencia;
    expect(goldPreviewSchema.safeParse(sem).success).toBe(false);
  });

  it("exige o papel no bloco fonte", () => {
    const semRole = { ...minimo, fonte: { ...minimo.fonte, role: undefined } };
    expect(goldPreviewSchema.safeParse(semRole).success).toBe(false);
  });

  it("rejeita papel desconhecido", () => {
    const outro = { ...minimo, fonte: { ...minimo.fonte, role: "root" } };
    expect(goldPreviewSchema.safeParse(outro).success).toBe(false);
  });

  it("rejeita composicao_tipo_evento como lista (o handler monta um mapa por mês, não um array)", () => {
    const listaEmVezDeMapa = {
      ...minimo,
      composicao_tipo_evento: [{ tipo: "Consulta", sinistro: 1000 }],
    };
    expect(goldPreviewSchema.safeParse(listaEmVezDeMapa).success).toBe(false);
  });
});
