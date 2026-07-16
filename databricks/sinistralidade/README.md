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

O arquivo `005` contém consultas diagnósticas. O `006` registra o baseline e cria
status `unknown` para períodos observados; ele nunca promove um mês a `closed`.
O `007` inventaria arquivos legados como `observed_unapproved`, sem simular aceite.

Execute primeiro em homologação. Os scripts são idempotentes, mas criam/alteram objetos e não devem ser apontados para produção sem a reconciliação registrada.

## Rollback

- A v1 não é alterada.
- Views v2 podem ser removidas sem impacto na v1.
- Tabelas de controle/snapshot devem ser preservadas para auditoria; desative consumidores antes de qualquer remoção.
