-- Camada física de serving para as consultas interativas mais frequentes.
-- As VIEWs v2 continuam sendo a definição canônica; este passo tira sua
-- recomputação do caminho online. Execute novamente após atualizar as fontes.

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_sinistro_empresa_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_top10_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_top10_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_top10_bimestre_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_top10_bimestre_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_saude_mental_internacao_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_saude_mental_internacao_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_ps_episodio_item_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_ps_episodio_item_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_fatura_coordenacao_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_fatura_coordenacao_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_familia_antes_depois_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_familia_antes_depois_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_comparativo_semestral_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_comparativo_semestral_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_evento_empresa_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_evento_empresa_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_pessoa_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_pessoa_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_procedimento_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_procedimento_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_internacao_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_internacao_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_internacao_grupo_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_internacao_grupo_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_prestador_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_prestador_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_concentracao_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_concentracao_mes_v2;

CREATE OR REPLACE TABLE hive_metastore.sanus_prod.serving_ps_item_mes_v2
USING DELTA
AS SELECT * FROM hive_metastore.sanus_prod.mart_ps_item_mes_v2;

ANALYZE TABLE hive_metastore.sanus_prod.serving_sinistro_empresa_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_top10_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_top10_bimestre_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_saude_mental_internacao_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_ps_episodio_item_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_fatura_coordenacao_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_familia_antes_depois_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_comparativo_semestral_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_evento_empresa_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_pessoa_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_procedimento_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_internacao_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_internacao_grupo_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_prestador_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_concentracao_mes_v2 COMPUTE STATISTICS;
ANALYZE TABLE hive_metastore.sanus_prod.serving_ps_item_mes_v2 COMPUTE STATISTICS;
