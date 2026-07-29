import { z } from "zod";
import { dashboardRoleSchema } from "./common";

const serieMensal = z.object({
  mes: z.string(),
  utilizantes: z.number(),
  itens: z.number(),
  sinistro: z.number(),
  parcial: z.boolean(),
  estado: z.enum(["closed", "partial", "unknown"]),
});

const serieCompetencia = z.object({
  mes: z.string(),
  sinistro: z.number(),
  servicos: z.number(),
  linhas: z.number(),
});

export const goldPreviewSchema = z.object({
  filtros: z.object({
    aplicados: z.record(z.string(), z.array(z.string())),
    disponiveis: z.object({}).passthrough(),
    notas: z.array(z.string()),
  }),
  fonte: z.object({
    gold: z.string(),
    contract_version: z.string(),
    delta_version: z.number(),
    delta_timestamp: z.unknown(),
    gerado_em: z.string(),
    filtro: z.string(),
    role: dashboardRoleSchema,
  }),
  mensal: z.array(serieMensal),
  competencia: z.array(serieCompetencia),
  // Mapa mês -> tipo de evento -> sinistro (não uma lista): construído em
  // gold-preview.ts como `Record<string, Record<string, number>>`.
  composicao_tipo_evento: z.record(z.string(), z.record(z.string(), z.number())),
  kpis: z.object({
    periodo: z.enum(["closed", "observed"]),
    ultimo_mes_fechado: z.string().nullable(),
    sinistro_ultimo_mes_fechado: z.number().nullable(),
    utilizantes_ultimo_mes_fechado: z.number().nullable(),
    janela_12m: z.array(z.string()),
    sinistro_12m: z.number(),
    utilizantes_12m: z.number(),
    custo_por_utilizante_12m: z.number().nullable(),
    reembolso_share_12m: z.number().nullable(),
  }),
  lotacoes: z.array(z.object({ lotacao: z.string(), sinistro: z.number(), beneficiarios: z.number(), share: z.number().nullable() })),
  prestadores: z.object({
    total_prestadores: z.number(),
    sinistro_total: z.number(),
    top: z.array(z.object({ prestador: z.string(), sinistro: z.number(), share: z.number().nullable() })),
  }),
  concentracao: z.object({
    janela: z.array(z.string()),
    utilizantes: z.number(),
    top1_pessoas: z.number(),
    // toNum() nunca devolve null (cai para 0); não usar .nullable() aqui.
    top1_share: z.number(),
    top5_share: z.number(),
  }),
  internacao: z.object({
    por_agrupamento: z.array(z.object({ agrupamento: z.string(), sinistro_mi: z.number() })),
    linhas_assistenciais: z.number(),
    internacoes_distintas: z.number(),
    beneficiarios_unicos: z.number(),
    dias_internados: z.number(),
    custo_medio: z.number(),
    duracao_mediana_dias: z.number(),
    duracao_p90_dias: z.number(),
  }),
  saude_mental: z.object({
    share_flag: z.number().nullable(),
    share_sem_classificacao: z.number().nullable(),
    por_tema_mi: z.array(z.object({ tema: z.string(), sinistro_mi: z.number() })),
  }),
  impacto_sanus: z.object({}).passthrough(),
  comparacao_madura: z.object({}).passthrough(),
  jornada_sanus: z.object({}).passthrough(),
  top_utilizantes: z.object({
    janela: z.array(z.string()),
    aviso: z.string(),
    lista: z.array(z.object({
      codigo_usuario: z.string(),
      id_corrompido: z.boolean(),
      faixa_etaria: z.string(),
      parentesco: z.string(),
      lotacao: z.string(),
      custo: z.number(),
      itens: z.number(),
      internacoes: z.number(),
      share: z.number(),
    })),
  }),
  carteira: z.object({
    operadoras: z.array(z.string()),
    empresas: z.array(z.object({ nome: z.string(), sinistro: z.number(), share: z.number().nullable(), beneficiarios: z.number() })),
    beneficiarios_total: z.number(),
  }),
});

export type GoldPreview = z.infer<typeof goldPreviewSchema>;
