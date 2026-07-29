# Design — documentação de entrega da Sinistralidade 360

## Objetivo

Produzir um único documento Word (`.docx`) que permita a uma pessoa de produto,
dados ou engenharia entender, operar e evoluir a camada analítica da
Sinistralidade 360 sem depender do autor original. A apresentação final não faz
parte desta entrega; o documento incluirá somente um roteiro de demonstração
reutilizável.

## Público e linguagem

O documento atenderá dois públicos no mesmo fluxo de leitura:

- liderança e produto: o que a dashboard responde, quais decisões ela suporta e
  quais limites devem ser respeitados;
- dados e engenharia: como os dados são transformados, onde estão os objetos e
  como alterar uma métrica, query, rota ou componente com segurança.

Termos técnicos serão acompanhados de definição curta na primeira ocorrência.
Não haverá dados pessoais, credenciais, valores de tokens ou amostras de linhas
identificáveis.

## Estrutura proposta

1. **Resumo executivo** — escopo entregue, estado de publicação e principais
   decisões de arquitetura.
2. **Como o dado chega à dashboard** — origem, ingestão, Bronze, Silver, Gold,
   marts, API e interface; inclui diagrama de lineage e cadência de atualização.
3. **Gold e contratos de dados** — grão, chaves opacas, controle de período,
   elegibilidade, PII e classificação nativa sem LLM como fonte analítica.
4. **Dicionário e métricas** — objetos de dados, dimensões, medidas, fórmulas,
   unidades e semânticas que distinguem rubrica de internação e episódio de
   internação.
5. **Queries, views e integração** — SQL versionado, ordem de deploy, marts,
   API, escopos/rotas e consumidores da interface.
6. **Guia de manutenção da dashboard** — localizar uma métrica, alterar SQL,
   alterar contrato/serializador, alterar componente e validar; descreve gates,
   feature flags e company scopes.
7. **Limitações e riscos** — somente fatos observados: publicação parcial,
   atualização manual, HML no mesmo schema, versionamento divergente, dado de
   data suspeita, dependências externas e controles de segurança pendentes.
8. **Backlog priorizado** — ações P0/P1/P2 derivadas dos riscos, sem prometer
   dados ou permissões ainda indisponíveis.
9. **Roteiro de demo futura** — sequência para demonstrar a plataforma criada
   pelo Allex: origem, transformação, métricas, dashboard, lineage e limites.
10. **Referências** — caminhos locais para SQL, rotas, componentes, testes e
    documentação canônica.

## Fontes canônicas

O conteúdo será consolidado a partir de:

- `docs/sinistralidade/ARQUITETURA_DATABRICKS.md`;
- `docs/sinistralidade/CAMADA_DE_DADOS.md`;
- `docs/sinistralidade/IMPLEMENTACAO.md`;
- `docs/sinistralidade/contrato-silver-gold-v2.md`;
- `docs/sinistralidade/metricas-v2.yaml`;
- `databricks/sinistralidade/sql/001` a `010`;
- `src/server/sinistralidade/`, `src/server/routes/sinistralidade-v2.ts` e
  `src/features/sinistralidade/`;
- evidências read-only registradas na auditoria de 2026-07-29.

Quando as fontes divergirem, o documento separará explicitamente: estado ao
vivo, código versionado e documentação histórica. Não normalizará divergências
por suposição.

## Artefato e verificação

- Entrega: `api/docs/sinistralidade/Entrega_Sinistralidade_360.docx`.
- O arquivo será criado localmente, renderizado em imagens e revisado antes da
  entrega para verificar paginação, títulos, tabelas, diagrama e legibilidade.
- A camada de dados e a dashboard não serão modificadas.
- Não serão criados novos objetos no Databricks nem serão executados jobs,
  notebooks ou comandos de escrita.

## Critérios de aceite mapeados

| Critério | Seção do documento |
| --- | --- |
| Explica como os dados chegam à dashboard | 2 e 5 |
| Regras de cálculo reproduzíveis | 3 e 4 |
| Localizar e alterar queries | 5 e 6 |
| Adicionar ou modificar componentes | 5 e 6 |
| Limitações e riscos registrados | 7 |
| Origem, transformação, métricas, dashboard e aprendizados para demo | 9 |
| Demo dentro da plataforma do Allex | Roteiro da seção 9; execução fica para a apresentação posterior |
