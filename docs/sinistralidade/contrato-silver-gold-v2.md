# Contrato Silver → Gold de sinistralidade v2

Versão técnica: `1.0.0`

Status comercial: aguardando aprovação do glossário

## Fontes

- Silver: `hive_metastore.sanus_prod.utilizacao_silver_final`
- Cadastro atual: `hive_metastore.sanus_prod.vw_beneficiarios`
- Coordenação: `hive_metastore.sanus_prod.atendimento_gold_live`
- HealthCoach: `hive_metastore.sanus_prod.healthcoach_gold_live`
- Gold v1 preservada: `hive_metastore.sanus_prod.gold_sinistro_evento`

## Objetos v2

- `gold_sinistro_evento_v2`: fato assistencial com chaves canônicas e lineage.
- `dim_empresa_gold_v2`: empresas canônicas observadas.
- `sinistralidade_ingestion_manifest_v2`: controle de arquivos esperados/recebidos.
- `sinistralidade_month_status_v2`: gate de mês fechado.
- `beneficiary_eligibility_snapshot_v2`: snapshots imutáveis de elegibilidade.
- `fact_elegibilidade_mensal_gold_v2`: exposição agregada por pessoa e mês.
- `fact_coordenacao_evento_gold_v2`: contatos associados por empresa e titular, sem CPF exposto.
- marts mensais, rankings, PS, saúde mental, coordenação, família e semestre: consumo otimizado pela API.

## Grão e chaves

### Fato assistencial

- Grão: uma linha de cobrança da operadora.
- Chave de origem: `row_sha256`.
- `company_key`: operadora + código/nome canônico de empresa.
- `person_key`: identidade resolvida dentro da empresa.
- `family_key`: titular normalizado dentro da empresa.
- `episode_key`: empresa + pessoa + conta/autorização + data + prestador.

### Elegibilidade

- Snapshot: uma pessoa por data de snapshot e empresa.
- Mensal: uma pessoa por empresa e mês.
- Histórico não deve ser inferido retroativamente usando apenas o snapshot atual.

## Compatibilidade

- Objetos v1 não serão substituídos durante shadow mode.
- Campos novos são aditivos dentro da mesma versão principal.
- Remoção, mudança de tipo ou fórmula exige nova versão principal.
- Toda publicação registra `contract_version` e `built_at`.

## Qualidade mínima para publish

- `row_sha256` única e não nula.
- Reconciliação de linhas e custo bruto com a Silver.
- `company_key` presente em 100% das linhas publicáveis.
- `person_key` resolvida em pelo menos 99% ou exceção aprovada.
- Nenhuma mistura de empresa em chaves, cache ou payload.
- Cobertura de TUSS, evento, CID e saúde mental reportada por empresa/mês.
- Mês só é fechado por manifest e reconciliação, nunca por heurística visual.

## PII

- CPF e identificadores brutos permanecem somente na camada controlada.
- A API usa chaves opacas e valores mascarados.
- Logs não incluem CPF, nome, CID individual ou texto clínico.
- Top 10 individual requer permissão específica.
