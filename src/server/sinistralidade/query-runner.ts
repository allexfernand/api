// Execução de consultas da Sinistralidade 360 com observabilidade por escopo.
// Nenhum SQL ou dado sensível é propagado ao cliente em caso de erro.

import { resolveWarehouseId, runQuery, type DatabricksRow } from "../databricks/client";
import { logger } from "../observability/logger";

export type QueryRunner = (sql: string) => Promise<DatabricksRow[]>;

export const TABLES = {
  dimCompany: "hive_metastore.sanus_prod.dim_empresa_gold_v2",
  gold: "hive_metastore.sanus_prod.gold_sinistro_evento_v2",
  monthStatus: "hive_metastore.sanus_prod.sinistralidade_month_status_v2",
  qualityRun: "hive_metastore.sanus_prod.sinistralidade_quality_run_v2",
  martMonth: "hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2",
  martTop: "hive_metastore.sanus_prod.mart_top10_mes_v2",
  martBimester: "hive_metastore.sanus_prod.mart_top10_bimestre_v2",
  martMental: "hive_metastore.sanus_prod.mart_saude_mental_internacao_v2",
  martPsEpisode: "hive_metastore.sanus_prod.mart_ps_episodio_item_v2",
  martCare: "hive_metastore.sanus_prod.mart_fatura_coordenacao_v2",
  martFamily: "hive_metastore.sanus_prod.mart_familia_antes_depois_v2",
  martHalfYear: "hive_metastore.sanus_prod.mart_comparativo_semestral_v2",
  // Marts longitudinais 1.1.0
  martEventoMes: "hive_metastore.sanus_prod.mart_evento_empresa_mes_v2",
  martPessoaMes: "hive_metastore.sanus_prod.mart_pessoa_mes_v2",
  martProcedimentoMes: "hive_metastore.sanus_prod.mart_procedimento_mes_v2",
  martInternacaoMes: "hive_metastore.sanus_prod.mart_internacao_mes_v2",
  martInternacaoGrupoMes: "hive_metastore.sanus_prod.mart_internacao_grupo_mes_v2",
  martPrestadorMes: "hive_metastore.sanus_prod.mart_prestador_mes_v2",
  martConcentracaoMes: "hive_metastore.sanus_prod.mart_concentracao_mes_v2",
  martPsItemMes: "hive_metastore.sanus_prod.mart_ps_item_mes_v2",
  martFamiliaRelativo: "hive_metastore.sanus_prod.mart_familia_mes_relativo_v2",
  martCoordenacaoMes: "hive_metastore.sanus_prod.mart_coordenacao_empresa_mes_v2",
} as const;

export async function createQueryRunner(scope: string): Promise<QueryRunner> {
  const warehouseId = await resolveWarehouseId();
  return async (sql: string) => {
    const startedAt = Date.now();
    try {
      const rows = await runQuery(warehouseId, sql);
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
