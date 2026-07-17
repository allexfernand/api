# Databricks · Sinistralidade v2

Código versionado para construir a camada v2 sem substituir a Gold atual.

## Ordem

1. `sql/001_control_tables.sql`
2. `sql/002_gold_event_v2.sql`
3. `sql/003_dimensions_and_eligibility.sql`
4. `sql/004_analytics_marts.sql`
5. `sql/005_quality_checks.sql`
6. `sql/006_quality_baseline.sql`
7. `sql/007_manifest_baseline.sql`
8. `sql/008_longitudinal_marts.sql`
9. `sql/009_longitudinal_quality_checks.sql`
10. `sql/010_longitudinal_baseline.sql`

O arquivo `005` contém consultas diagnósticas. O `006` registra o baseline e cria
status `unknown` para períodos observados; ele nunca promove um mês a `closed`.
O `007` inventaria arquivos legados como `observed_unapproved`, sem simular aceite.

O `008` cria os dez marts longitudinais do contrato `1.1.0` (evento, pessoa,
procedimento, internação, grupo de internação, prestador, concentração, itens de
PS, família relativa e coordenação) como views em shadow mode. O `009` contém os
gates diagnósticos read-only (grão, reconciliação de custo/pessoas/episódios,
participação, densidade, cobertura, associação de PS e Preview Gold × V2). O
`010` registra o baseline longitudinal em `sinistralidade_quality_run_v2` com
`quality_run_id = 'longitudinal-baseline-<data>'`; nunca promove mês a `closed`.
Materialize em Delta (particionando por `company_key`/`month_key`) apenas se o
p95 das consultas exceder o orçamento da API; enquanto views, o processamento é
sempre consistente com a Gold e o incremento é herdado do manifest.

Execute primeiro em homologação. Os scripts são idempotentes, mas criam/alteram objetos e não devem ser apontados para produção sem a reconciliação registrada.

## Rollback

- A v1 não é alterada.
- Views v2 podem ser removidas sem impacto na v1.
- Tabelas de controle/snapshot devem ser preservadas para auditoria; desative consumidores antes de qualquer remoção.
