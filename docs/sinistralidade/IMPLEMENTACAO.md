# Sinistralidade multiempresa v2 — estado da implementação

Data do baseline: 2026-07-16

Contrato: `1.1.0` (aditivo sobre `1.0.0`; nenhum significado de métrica publicada mudou)

Modo: shadow; a Gold v1 permanece ativa. A experiência longitudinal 1.1.0 está
implementada e desligada por feature flag.

## Entregue

- Glossário comercial e contrato Silver → Gold versionados.
- DDL idempotente, manifest de arquivos, gate de mês e trilha de qualidade.
- Chaves opacas de operadora, empresa, pessoa, família e episódio.
- Gold v2 multiempresa sem filtros fixos da Azul.
- Company scopes obrigatórios na API e rankings individuais mascarados.
- Snapshot mensal de elegibilidade iniciado em 2026-07-16, sem retroação artificial.
- Marts mensal, Top 10 mensal, Top 10 bimestral, saúde mental, pacote de PS,
  fatura × coordenação, família antes/depois e comparativo janeiro–junho.
- Nova aba destacada “Sinistralidade 360” no dashboard, com visão executiva,
  tendência de 12 meses, comparação bimestral, rankings, família antes/depois,
  saúde mental, matriz fatura × coordenação, itens de PS e gate anual.
- Gate HTTP `409` para métricas de mês não fechado quando `include_partial` não é autorizado.

## Evolução longitudinal 1.1.0 (2026-07-16)

- Dez marts longitudinais em shadow mode (`008_longitudinal_marts.sql`):
  `mart_evento_empresa_mes_v2`, `mart_pessoa_mes_v2`, `mart_procedimento_mes_v2`,
  `mart_internacao_mes_v2`, `mart_internacao_grupo_mes_v2`, `mart_prestador_mes_v2`,
  `mart_concentracao_mes_v2`, `mart_ps_item_mes_v2`, `mart_familia_mes_relativo_v2`
  e `mart_coordenacao_empresa_mes_v2`. Internações contadas por
  `count(distinct episode_key)` com classificação de saúde mental no grão do episódio.
- Gates longitudinais (`009`) executados sem violações; baseline registrado em
  `sinistralidade_quality_run_v2` com `quality_run_id = 'longitudinal-baseline-2026-07-16'`
  (8/8 `passed`).
- Contrato `1.1.0` com doze escopos novos (`timeline`, `event-mix`, `top-users-window`,
  `user-detail`, `procedure-trends`, `hospitalization-trends`, `provider-trends`,
  `concentration`, `company-benchmark`, `family-timeline`, `care-timeline`, `ps-trends`)
  e envelope com estado explícito (`valid | partial | blocked | not_comparable`),
  período solicitado × efetivo, status mensal, unidades, cobertura, advertências e
  `quality_run_id`.
- Rota refatorada em adaptador HTTP + módulos `src/server/sinistralidade/`
  (period-gate, permissions, feature-flags, audit, serializers, query-runner e
  queries por escopo). Company scope aplicado no servidor e no SQL.
- Três níveis de acesso: agregado, ranking mascarado e detalhe clínico. Ranking e
  detalhe exigem flag + lista explícita de usuários (`SINISTRALIDADE_INDIVIDUAL_*_USERS`);
  MDS nunca recebe acesso individual; todo acesso individual é auditado; detalhe
  individual responde com `Cache-Control: no-store`.
- Frontend refatorado em componentes/hooks com gráficos SVG próprios (linhas,
  empilhado, Pareto, dispersão, sparkline), alternativa tabular acessível em todos
  os gráficos, estados reais por bloco (carregando, vazio, bloqueado, sem
  permissão, erro com retry) e progressive disclosure por bloco temático.
- Flags de rollout (todas `false` por padrão):
  `SINISTRALIDADE_360_LONGITUDINAL_ENABLED`,
  `SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED`,
  `SINISTRALIDADE_360_INDIVIDUAL_DETAIL_ENABLED`,
  `SINISTRALIDADE_360_COMPANY_BENCHMARK_ENABLED`.

### Validação da evolução (2026-07-16)

| Gate | Resultado |
| --- | --- |
| Grão dos marts longitudinais | `0` duplicatas em todos os grãos — aprovado |
| Custo por empresa/mês (evento, pessoa, procedimento, prestador) × Gold | `0` divergências acima de R$ 0,05 — aprovado |
| Utilizantes e episódios × cálculo direto na Gold | `0` divergências — aprovado |
| Participação por evento | soma 100% em todos os pares empresa/mês — aprovado |
| Concentração (monotonia e percentis) | `0` violações — aprovado |
| Densidade das séries | todos os pares empresa/mês da Gold presentes — aprovado |
| Associação de itens de PS ao episódio | `0` itens órfãos — aprovado |
| API 1.1.0 | 12 escopos respondendo; `409` com envelope para janela sem mês fechado; `403` para flag/permissão; `404` para pessoa fora da empresa; `no-store` no detalhe individual |
| Reconciliação timeline × Gold | 2026-04 = `R$ 6.474.995,62` em ambos — aprovado |
| Testes da aplicação | 31 unitários, lint, typecheck e build de produção aprovados |

Divergência conhecida Preview Gold × V2: `R$ 2.760,00` (custo total), integralmente
explicada pelas linhas com `flag_data_suspeita` que a V2 exclui do período oficial e
a Preview Gold (v1) inclui. Registrada no check `preview_gold_vs_v2` do `009`.

O teste E2E `dashboard.spec.ts` falha na aba “Petit Comitê MDS” também no commit
base — falha pré-existente, não relacionada a esta entrega.

### Ferramentas operacionais (2026-07-17)

- `npm run databricks:sinistralidade:close-month -- --company=<key> --month=YYYY-MM --approved-by="Nome" [--apply] [--approve-manifest]`
  — fechamento formal de mês (GOV-03). Valida manifest reconciliado/aprovado,
  reconcilia linhas e custo da Gold v2 com o baseline registrado e exige última
  rodada de qualidade sem reprovação; só então marca `closed` com `closed_at` e
  `approved_by`. Dry-run por padrão. Testado: bloqueia corretamente enquanto o
  manifest estiver `observed_unapproved`.
- `npm run databricks:sinistralidade:onboard -- [--company=<key>] [--apply]`
  — homologação de empresa (GOV-10). Inventaria empresas observadas (alias,
  manifest, month_status, meses), roda gates escopados na candidata
  (reconciliação de custo dos marts, grão pessoa-mês, fallback de identidade
  ≤ 1%) e reporta cobertura por mês para o dossiê. `--apply` registra meses
  faltantes como `unknown`; nunca promove a `closed` nem aprova alias.
  Testado com a ATS: gates aprovados, cobertura reportada.

### Gaps demográficos fatura × coordenação (2026-07-17)

O escopo `care-timeline` passou a retornar `demographics`: quadrantes de
fatura × coordenação por sexo, vínculo e estado (pessoa distinta na janela,
direto do `mart_fatura_coordenacao_v2`, com supressão de pequenos grupos para
perfis externos). A UI ganhou a tabela “Gaps demográficos do período”
priorizada pelo maior gap de uso sem coordenação. Limitação vigente: como o
primeiro snapshot de elegibilidade (2026-07) é posterior à última competência
de utilização carregada (2026-06), o quadrante “usa sem coordenação” permanece
vazio até chegarem snapshots contemporâneos à utilização — comportamento
correto, não é preenchido com zero artificial.

### Preview Gold migrada para a base v2 (2026-07-16)

`src/server/routes/gold-preview.ts` deixou de ler a Gold v1 e passou a consumir
`gold_sinistro_evento_v2` + marts v2, preservando o shape do payload (o frontend
da aba não mudou). Diferenças de base:

- identidade por `person_key` opaco; a reconstrução manual de `codigo_usuario`
  corrompido foi removida (a Gold v2 já resolve identidade);
- Top utilizantes mascarado (`Beneficiário xxxxxxxx`) — nenhum código de origem
  exposto;
- internações por `count(distinct episode_key)`, não por conta médica;
- família por `family_key`; filtros de serviço Sanus e jornada usam a ponte da
  `fact_coordenacao_evento_gold_v2` (sem CPF em SQL);
- cidade/estado via `beneficiary_eligibility_snapshot_v2` (removido o literal
  `LIKE '%AZUL%'` — multiempresa);
- company scope do usuário aplicado em todas as consultas;
- `fonte.gold = "gold_sinistro_evento_v2"`, `contract_version = "1.1.0"`.

Números conferidos após a migração: 12 meses fechados heurísticos idênticos ao
comportamento anterior, `sinistro_12m = R$ 117.733.215,64`, concentração e
internações coerentes com os marts v2; filtros de serviço/sexo/estado testados
com resultados não vazios e coerentes.

## Validação registrada

| Gate | Resultado |
| --- | --- |
| Linhas Silver × Gold v2 | `1.571.862 × 1.571.862` — aprovado |
| Custo bruto Silver × Gold v2 | `R$ 165.743.202,33 × R$ 165.743.202,33` — aprovado |
| Empresa canônica | `0` linhas sem `company_key` — aprovado |
| Identidade por fallback | `0,059%`, limite `1%` — aprovado |
| Participação por empresa/mês | soma `100%` em todos os meses — aprovado |
| Snapshot atual | `162.931` pares únicos empresa+pessoa |
| Coordenação | `124.072` eventos sem duplicação da chave publicada |
| Testes da aplicação | unitários, tipos, lint e build de produção aprovados |
| API | todos os sete escopos analíticos responderam; gate não fechado retornou `409` |

Os resultados estão registrados em
`hive_metastore.sanus_prod.sinistralidade_quality_run_v2` com
`quality_run_id = 'gold-v2-baseline-2026-07-16'`.

## Gates mantidos fechados

- Os `128` pares empresa-mês observados estão como `unknown`, não `closed`.
- Janeiro–junho de 2025 e 2026 está com `blocked_incomplete_or_unapproved`.
- Custo por vida elegível histórico permanece `null`, pois o primeiro snapshot é posterior
  ao último mês de utilização carregado.
- Dependentes permanecem com `dependent_without_family_bridge`, pois
  `vw_beneficiarios` não expõe a identidade do titular do dependente.

## Dependências externas

1. Receber e homologar um arquivo real de utilização de empresa externa ao conjunto atual.
2. Receber snapshots mensais futuros para formar denominadores históricos válidos.
3. Aprovação de negócio do glossário, coparticipação e regra de entrada familiar.
4. Marcação formal dos meses como `closed` após manifest, reconciliação e aprovação.
5. Criar o schema dedicado de homologação ou conceder `CREATE SCHEMA`; o usuário atual não
   possui essa permissão. Até lá, os objetos paralelos usam sufixo `_v2` no schema existente.
6. Retomar a integração do serviço TUSS quando houver decisão e contrato operacional.

## Configuração de publicação

Defina `DASHBOARD_AUTH_COMPANY_SCOPES` e `DASHBOARD_MDS_COMPANY_SCOPES` como listas de
`company_key` separadas por vírgula. `*` é permitido somente para administradores internos.
O papel `full` mantém acesso administrativo a todas as empresas em deploys legados
quando a variável não existe. Uma variável explicitamente vazia bloqueia o papel.
O papel `mds` continua sem acesso por padrão.

O comparativo janeiro–junho deve continuar oculto/bloqueado enquanto os dois anos não
tiverem seis meses fechados. Não alterar esse comportamento por inferência de volume.

## Estado por bloco (evolução 1.1.0)

- **Concluído**: fundação Databricks + gates, contrato `1.1.0`, refatoração de rota,
  níveis de acesso e auditoria, resumo executivo (KPIs, evolução, composição por
  evento), procedimentos, internações/saúde mental, prestadores, concentração,
  coordenação, PS longitudinal, testes e build.
- **Shadow mode / gate fechado**: toda a experiência longitudinal (flag master
  desligada); ranking individual e drawer clínico (flags + listas de usuários);
  comparação entre empresas (flag desligada).
- **Bloqueado externamente**: benchmark oficial multiempresa (falta arquivo real de
  empresa externa homologado); custo por vida e internações por mil vidas históricos
  (faltam snapshots mensais retroativos); fechamento formal de meses (`closed`);
  linha do tempo familiar completa (ponte de dependentes ausente na origem);
  exposição de CID/diagnóstico (aguarda aprovação clínica — hoje nenhum escopo
  novo retorna CID).
- **Dívida técnica**: cobertura calculada por consulta (avaliar cache/materialização
  se o p95 estourar o orçamento); marts como views (materializar pessoa/procedimento/
  prestador em Delta se necessário); testes de componente visual e regressão visual
  automatizada ainda não cobrem os novos blocos; corrigir o E2E pré-existente da aba
  “Petit Comitê MDS”.

## Próxima evolução

O plano completo, com o checklist de execução atualizado, está em
`docs/sinistralidade/PLANO_EVOLUCAO_ANALITICA_360.md`.

## Semântica de métricas (auditoria 2026-07-17)

Registro das definições fixadas após a auditoria da camada de dados:

- **Internações = ADMISSÕES.** O `episode_key` da Gold inclui `Data_Atendto`
  (grão atendimento-dia); uma internação faturada em várias datas gerava vários
  "episódios". Os marts de internação (004/008) agora contam `admission_key`
  (hash de empresa + pessoa + conta + senha + prestador, sem a data), com o mês
  atribuído ao primeiro mês observado. A coluna `atendimentos_dia` preserva a
  contagem antiga para reconciliação (check `admission_vs_day_ratio`, 009).
- **Flags de exibição**: padrão ligado; defina a env como `false` para desligar.
  Listas `SINISTRALIDADE_INDIVIDUAL_*_USERS` vazias liberam por padrão (MDS
  continua sem acesso individual).
- **`vidas_elegiveis` = `sum(member_month_weight)`** (vida-mês). Todo indicador
  "por vida" é na prática **por vida-mês** (padrão PMPM): `custo_por_vida_elegivel`
  divide o custo da janela pela soma dos denominadores mensais.
- **"Custo por utilizante"** tem duas definições distintas e rotuladas:
  KPI executivo = pessoas DISTINTAS na janela; benchmark/procedimentos =
  soma de utilizantes-mês (`monthly_utilizers_sum`, pessoa conta por mês).
- **Participações/shares** nos payloads longitudinais são **frações (0–1)**;
  variações MoM/YoY são **percentuais (0–100)**. O mapa `units` de cada scope
  reflete isso ("fração (0–1)" vs "%").
- **Estornos** (`flag_estorno`, custo negativo) permanecem nas somas (custo
  líquido real), mas pessoas com custo líquido ≤ 0 no mês ficam fora do ranking
  de concentração para manter o acumulado monotônico; share de estornos é
  monitorado pelo check `refund_share` (009).
- **`mart_top10_bimestre_v2`** entrega o ranking completo; o corte Top 10 é do
  consumidor. **`mart_comparativo_semestral_v2.sinistros`** = linhas de
  cobrança (coluna `linhas_cobranca` explícita adicionada).
- **Benchmark multiempresa**: o gate de período usa o status agregado das
  empresas do escopo (fechado somente se todas fecharam o mês), em vez de uma
  linha inexistente `company_key='*'`.
- **Séries densas por entidade** (ranking, procedimentos, prestadores, detalhe
  individual): mês coberto sem consumo = 0; mês sem cobertura da empresa =
  `null` — nunca zero, inclusive com `include_partial=true`.
