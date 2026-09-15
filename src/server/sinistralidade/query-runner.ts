// Execução de consultas da Sinistralidade 360 com observabilidade por escopo.
// Nenhum SQL ou dado sensível é propagado ao cliente em caso de erro.

import { resolveWarehouseId, runQuery, type DatabricksRow, type SqlParameter } from "../databricks/client";
import { logger } from "../observability/logger";

export type QueryRunner = (sql: string, parameters?: SqlParameter[]) => Promise<DatabricksRow[]>;

const useServingMarts = process.env.SINISTRALIDADE_USE_SERVING_MARTS === "true";
const martTable = (martName: string, servingName: string) =>
  `hive_metastore.sanus_prod.${useServingMarts ? servingName : martName}`;

export const TABLES = {
  dimCompany: "hive_metastore.sanus_prod.dim_empresa_gold_v2",
  gold: "hive_metastore.sanus_prod.gold_sinistro_evento_v2",
  monthStatus: "hive_metastore.sanus_prod.sinistralidade_month_status_v2",
  qualityRun: "hive_metastore.sanus_prod.sinistralidade_quality_run_v2",
  martMonth: martTable("mart_sinistro_empresa_mes_v2", "serving_sinistro_empresa_mes_v2"),
  martTop: martTable("mart_top10_mes_v2", "serving_top10_mes_v2"),
  martBimester: martTable("mart_top10_bimestre_v2", "serving_top10_bimestre_v2"),
  martMental: martTable("mart_saude_mental_internacao_v2", "serving_saude_mental_internacao_v2"),
  martPsEpisode: martTable("mart_ps_episodio_item_v2", "serving_ps_episodio_item_v2"),
  martCare: martTable("mart_fatura_coordenacao_v2", "serving_fatura_coordenacao_v2"),
  martFamily: martTable("mart_familia_antes_depois_v2", "serving_familia_antes_depois_v2"),
  martHalfYear: martTable("mart_comparativo_semestral_v2", "serving_comparativo_semestral_v2"),
  // Marts longitudinais 1.1.0
  martEventoMes: martTable("mart_evento_empresa_mes_v2", "serving_evento_empresa_mes_v2"),
  martPessoaMes: martTable("mart_pessoa_mes_v2", "serving_pessoa_mes_v2"),
  martProcedimentoMes: martTable("mart_procedimento_mes_v2", "serving_procedimento_mes_v2"),
  martInternacaoMes: martTable("mart_internacao_mes_v2", "serving_internacao_mes_v2"),
  martInternacaoGrupoMes: martTable("mart_internacao_grupo_mes_v2", "serving_internacao_grupo_mes_v2"),
  martPrestadorMes: martTable("mart_prestador_mes_v2", "serving_prestador_mes_v2"),
  martConcentracaoMes: martTable("mart_concentracao_mes_v2", "serving_concentracao_mes_v2"),
  martPsItemMes: martTable("mart_ps_item_mes_v2", "serving_ps_item_mes_v2"),
  martFamiliaRelativo: "hive_metastore.sanus_prod.mart_familia_mes_relativo_v2",
  martCoordenacaoMes: "hive_metastore.sanus_prod.mart_coordenacao_empresa_mes_v2",
  // Tabelas consultadas por src/server/routes/gold-preview.ts (aba Análise
  // Sinistro), sem mart próprio na Visão 360.
  factCoordenacao: "hive_metastore.sanus_prod.fact_coordenacao_evento_gold_v2",
  eligibilitySnapshot: "hive_metastore.sanus_prod.beneficiary_eligibility_snapshot_v2",
  // Silver base da Gold v2: única consumidora é o DESCRIBE HISTORY que alimenta
  // o selo de versão/atualização exibido no cabeçalho da Análise Sinistro
  // (fonte.delta_version/delta_timestamp) — nenhum bloco de conteúdo lê esta
  // tabela diretamente. Ver claims.freshness em gold-preview-lineage.ts.
  silverFinal: "hive_metastore.sanus_prod.utilizacao_silver_final",
} as const;

export async function createQueryRunner(scope: string): Promise<QueryRunner> {
  const warehouseId = await resolveWarehouseId();
  return async (sql: string, parameters?: SqlParameter[]) => {
    const startedAt = Date.now();
    try {
      const rows = await runQuery(warehouseId, sql, parameters);
      logger.info("sinistralidade.query", {
        scope,
        durationMs: Date.now() - startedAt,
        rowCount: rows.length,
      });
      return rows;
    } catch (cause) {
      logger.error("sinistralidade.query_failed", {
        scope,
        durationMs: Date.now() - startedAt,
        message: cause instanceof Error ? cause.message : "erro desconhecido",
      });
      const error = new Error("Falha ao consultar a base analítica de sinistralidade.");
      Object.assign(error, { statusCode: 502 });
      throw error;
    }
  };
}
