# Sinistralidade multiempresa v2 — estado da implementação

Data do baseline: 2026-07-16

Contrato: `1.0.0`

Modo: shadow; a Gold v1 permanece ativa.

## Entregue

- Glossário comercial e contrato Silver → Gold versionados.
- DDL idempotente, manifest de arquivos, gate de mês e trilha de qualidade.
- Chaves opacas de operadora, empresa, pessoa, família e episódio.
- Gold v2 multiempresa sem filtros fixos da Azul.
- Company scopes obrigatórios na API e rankings individuais mascarados.
- Snapshot mensal de elegibilidade iniciado em 2026-07-16, sem retroação artificial.
- Marts mensal, Top 10 mensal, Top 10 bimestral, saúde mental, pacote de PS,
  fatura × coordenação, família antes/depois e comparativo janeiro–junho.
- Nova aba “Sinistralidade Multiempresa” no dashboard.
- Gate HTTP `409` para métricas de mês não fechado quando `include_partial` não é autorizado.

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
Sem configuração, o papel não enxerga nenhuma empresa.

O comparativo janeiro–junho deve continuar oculto/bloqueado enquanto os dois anos não
tiverem seis meses fechados. Não alterar esse comportamento por inferência de volume.
