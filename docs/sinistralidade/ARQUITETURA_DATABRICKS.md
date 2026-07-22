# Arquitetura de dados — Databricks (sanus_prod)

Raio-X do workspace feito ao vivo em 2026-07-20. Catálogo `hive_metastore`, schema único
`sanus_prod` (115 objetos). Warehouse: `Serverless Starter` (SMALL).

## Visão geral

Não é **um** medalhão uniforme — são **três paradigmas de ingestão convivendo no mesmo schema**,
distinguidos por sufixo de nome (não há separação por schema bronze/silver/gold):

| Paradigma | Domínios | Bronze/Silver | Gold/consumo | Atualização |
|---|---|---|---|---|
| **A. Batch medallion** | Sinistralidade | TABELAS | Gold + marts = **VIEWS** | Job manual (Python) |
| **B. DLT `_live`** | Atendimento, HealthCoach, Comentários, Qualidade | TABELAS materializadas | TABELAS materializadas | Pipeline contínua |
| **C. Replicação `__stg`** | Beneficiários, Organizações, Users, Botmaker | espelho + tabela | — | ELT gerenciado |

---

## A. Sinistralidade — batch medallion (o que trabalhamos)

```
utilizacao_raw_bronze      TABLE  1.571.862   ← arquivos da CNU (raw fiel)
   │  job: sanus_utilizacao_bronze_to_silver_stage (Python, dbfs:/tmp/sanus/jobs/…)
   ▼
utilizacao_silver_stage → utilizacao_silver_final   TABLE  1.571.862
   +  tuss_mappings_silver   TABLE  18.674  (referência procedimento→classificação; ⚠️ contém LLM)
   ▼
gold_sinistro_evento_v2    VIEW   (1:1 com a Silver, recalcula na leitura)
   │  + dim_empresa_gold_v2, fact_elegibilidade_mensal_gold_v2, fact_coordenacao_evento_gold_v2 (VIEWS)
   ▼
13 marts *_v2 (VIEWS)  →  API  →  Sinistralidade 360 / PREVIEW-gold
   controle (TABELAS Delta): sinistralidade_month_status_v2, _ingestion_manifest_v2,
                             _quality_run_v2, _company_alias_v2, beneficiary_eligibility_snapshot_v2
```

**Características:**
- **Gold e marts são VIEWS** → sempre consistentes com a Silver, sem cópia; pagam compute a cada consulta
  (o README prevê materializar em Delta se o p95 estourar).
- **Refresh é MANUAL:** o job Bronze→Silver **não tem agenda** (`trigger: manual`). Execuções recentes
  esparsas: 30/mai, 15/jun, 07/jul. A Silver só atualiza quando alguém roda o job; Gold/marts (views)
  refletem na hora. **Freshness depende de execução manual.**
- **Gold v1** (`gold_sinistro_evento`) foi aposentada (só resta a view raiz, aguardando DROP do owner);
  4 views v1 já removidas.
- **Homologação:** 30 objetos `*_v2_hml` (marts + dim/fact + controle) convivem no mesmo schema.

## B. Engajamento/operação — DLT `_live` (materializado)

Pipeline contínua (padrão Delta Live Tables — sufixo `_live`, tudo materializado como TABELA):

```
atendimento_raw_bronze_live   2.152.216 → _cleaned_silver_live 2.110.292 → _gold_live 2.110.292 (+ _summarized)
healthcoach_raw_bronze_live   1.566.566 → _gold_live 260.383 (+ _recognized_entities, _insights_silver)
lista_comentarios_raw_bronze_live → _cleaned/_insights_silver → _gold_live 68.550 (+ _category)
quality_analysis_raw_bronze_live 67.277 → _silver_criteria / _silver_summary 66.406
dashboard_sessions_base_gold  289.506  (agregado gold p/ a aba Sessões)
```

Alimenta as abas **Sessões, Qualidade (operacional/estratégica), Coordenação de Cuidado, Agendamentos**.
Diferente da sinistralidade, aqui o gold é **materializado** (rápido, mas depende do refresh da pipeline).
*(A API de pipelines não respondeu ao token — provável restrição de permissão; a natureza DLT é inferida
do padrão de nomes e da materialização integral.)*

## C. Cadastro/replicação — `__stg`

Ingestão gerenciada (padrão espelho ELT): cada tabela tem um par `__stg`.
- `beneficiaries` 164.486 (+ `beneficiaries_wallets`), `organizations` 760, `users`, `users_deleted`,
  `partner_brokers`, `organization_partner_brokers`, `botmaker_chat/message/session`.
- Referências: **`cid10_reference` 14.233** (CID-10 nativo — relevante para o agrupamento clínico do B5),
  `conexa_post_consultations`.
- Views de conveniência: `vw_beneficiarios`, `vw_atendimento`, `vw_healthcoach`, `v_sanus_ativos`, etc.

---

## Observações e riscos de arquitetura

1. **Schema único sem separação de camadas** — bronze, silver, gold, marts, controle e hml no mesmo
   `sanus_prod`, namespaced por sufixo. Funciona, mas mistura maturidades (raw ao lado de mart ao lado de hml).
2. **Dois modelos de materialização** — sinistralidade (views, recompute-on-read) vs `_live` (tabelas).
   A sinistralidade nunca fica "stale vs Silver", mas custa compute; se o volume/uso crescer, considerar
   materializar os marts pesados (pessoa/procedimento/prestador) em Delta particionado, como o README aponta.
3. **Freshness da sinistralidade é manual** — o único job (Bronze→Silver) roda sob demanda, sem cron.
   Vale agendar (ex.: diário/semanal) ou documentar o gatilho, senão a Silver envelhece silenciosamente.
4. **LLM concentrado em `tuss_mappings_silver`** — é a única fonte de enriquecimento por IA que chega ao
   dashboard (ver VALIDACAO_DADOS_ENRIQUECIDOS.md). Substituível por dado nativo.
5. **`hml` no schema de produção** — homologação por sufixo (não por schema isolado, por falta de permissão
   de CREATE SCHEMA no token). Aceitável como esteira, mas o ideal seria um schema `sinistralidade_hml` próprio.
6. **Nenhum mês fechado** (`month_status` = tudo `unknown`) e **sem snapshots de elegibilidade** — o
   pipeline de governança (fechamento, denominador por vida) existe mas ainda não foi alimentado.

## Inventário resumido (115 objetos)

- 8 bronze · 10 silver · 10 gold · 6 dim/fact · 36 marts (18 prod + 18 hml) · 10 controle (5+5 hml) · 35 cadastro/aux.
