# Validação — dados enriquecidos vs nativos (remover dependência de LLM)

**Critério do negócio:** o dashboard **não pode depender de dado gerado por LLM**. Para cada campo,
validamos: (1) é nativo do arquivo da operadora, derivado por regra determinística, ou gerado por IA?
(2) se for IA, existe fonte nativa/determinística equivalente?

Investigação feita ao vivo na Bronze/Silver (2026-07-20). Sinais usados:
`mapping_source` (legacy_reclassified / **llm_suggestion** / **llm_generic_fallback**),
`criterio_saude_mental`, e comparação com as colunas `raw_*` da Bronze.

---

## Resumo executivo

**A IA (LLM) toca apenas a classificação de procedimento/evento.** Tudo que é financeiro, temporal,
identidade, demografia e rede é **nativo**. `flag_saude_mental` é **regra de palavra-chave, não IA**.

- **28% das linhas** têm classificação via LLM (`llm_suggestion` 25% + `llm_generic_fallback` 3%),
  concentrada em: `tipo_evento`, `macrogroup`, `grupo_procedimento`, `tuss_code`, `agrupamento_internacao`.
- Todos esses têm **fonte nativa** para substituir — **exceto um**: o agrupamento clínico de internação
  do bloco B5 ("Gastroenterológica", "Neurológica"…), que não existe no arquivo nativo.

---

## Classificação campo a campo

### ✅ Nativos (sem IA, sem mudança)
| Campo | Alimenta | Origem nativa |
|---|---|---|
| `custo_assistencial_bruto` (= Sinistro) | todo valor R$ | `raw` Sinistro |
| `quantidade_servicos` | serviços | `raw_quantidade` |
| `person_key` (carteirinha) | ranking, concentração | `raw_codigo_beneficiario` (validado) |
| `company` / operadora | filtro, benchmark | `raw_nome_empresa` / `raw_operadora` |
| `competencia_cobranca` | evolução por competência (C1) | `raw` competência |
| `data_atendimento` | evolução por atendimento | `raw_data_atendimento` |
| `flag_reembolso` | rede × reembolso | **`raw_reembolso`** (S/N nativo) |
| `prestador`, `tipo_prestador`, `especialidade` | prestadores | `raw_*` nativos |
| `faixa_etaria`, `parentesco`, `genero` | demografia | `raw_*` nativos |
| `duracao_internacao_dias` | internações | `raw_data_inicio_internacao`/`raw_data_alta` |
| grupo estatístico (diárias) | (novo, B1) | `raw_codigo_grupo_estatistico` |

### 🟡 Derivado por REGRA determinística (não é IA — decisão: manter ou trocar por nativo)
| Campo | Alimenta | Como é feito | Fonte nativa alternativa |
|---|---|---|---|
| `flag_saude_mental` | bloco Severidade | **regra de palavra-chave** (`keyword_psicologia_psicoterapia`, `keyword_psiquiatria_internacao`) — determinístico, sem IA | códigos nativos de psiquiatria (PDE/PDA) + psicologia (TNP) do grupo estatístico |
| `codigo_cid_normalizado` | cobertura | normalização determinística do CID cru | `raw_codigo_cid` |

### 🔴 Gerado/mapeado com LLM (28%) — PRECISA trocar por nativo
| Campo | Alimenta | Dependência LLM | Fonte nativa para substituir |
|---|---|---|---|
| `tipo_evento` | composição por evento, "evento principal", `flag_internacao`/`flag_pronto_socorro` | 28% via `tuss_mappings_silver` (llm) | **`raw_nome_grupo_estatistico`** (59 códigos nativos) → de-para (ver DE_PARA_TIPO_EVENTO.md) |
| `flag_internacao` | Severidade | herda do `tipo_evento` | **diárias nativas** (DEF/DAP/DUT/PDE… ctx=1,00) |
| `flag_pronto_socorro` | (PS) | herda do `tipo_evento` | **TUSS nativo 10101039** (consulta PS, 29.303 linhas) + **`raw_eme`** (emergência, S/N) |
| `macrogroup` | coluna "Grupo" (procedimentos) | 100% via `tuss_mappings` (28% llm) | **prefixo do TUSS nativo** (`raw_codigo_procedimento` já é TUSS: 10=consulta, 40=exame…) — de-para estrutural determinística; **ou remover a coluna** (feedback B3) |
| `grupo_procedimento` | (interno) | idem macrogroup | idem |
| `tuss_code` | (interno/cobertura) | 72% nativo, **28% inferido por LLM** | usar `raw_codigo_procedimento` (é TUSS quando presente); nos 28% sem código → marcar "sem TUSS", nunca inferir |

### ⚠️ Enriquecido SEM equivalente nativo limpo — decisão de negócio
| Campo | Alimenta | Problema |
|---|---|---|
| `agrupamento_internacao` (clínico) | **B5 · agrupamento clínico** ("Gastroenterológica", "Neurológica"…) | Essa categorização clínica **não vem no arquivo nativo** — é derivada (via `tuss_mappings`, com LLM). Não há coluna nativa equivalente. |

**Opções para o B5 (agrupamento clínico):**
1. **Derivar do CID nativo** (`raw_codigo_cid` → capítulo CID-10, determinístico e público) — mas cobertura de CID é baixa (~17%).
2. **Agrupar pela diária nativa** (UTI / Enfermaria / Apartamento / Day-hospital / Psiquiatria) — 100% nativo, muda o eixo de "clínico" para "tipo de acomodação".
3. **Remover** o agrupamento clínico do B5 até haver fonte nativa.

---

## Plano para zerar a dependência de LLM

| # | Ação | Fonte nativa | Depende de |
|---|---|---|---|
| 1 | `tipo_evento` ← grupo estatístico | `raw_nome_grupo_estatistico` | de-para validada (🚩 no DE_PARA_TIPO_EVENTO.md) |
| 2 | `flag_internacao` ← diárias nativas | grupo estatístico (D**/PD*/ISO/THT) | idem |
| 3 | `flag_pronto_socorro` ← TUSS PS + `raw_eme` | `raw_codigo_procedimento`=10101039, `raw_eme` | — |
| 4 | `macrogroup`/"Grupo" ← prefixo TUSS **ou** remover | `raw_codigo_procedimento` | decidir: de-para TUSS vs remover coluna |
| 5 | `tuss_code` ← nativo; 28% viram "sem TUSS" | `raw_codigo_procedimento` | — |
| 6 | B5 agrupamento clínico | CID nativo / diária / remover | decisão de negócio (3 opções acima) |
| 7 | `flag_saude_mental` | manter (regra, não IA) **ou** trocar por psiq/psico nativo | decisão |

**Pré-requisito técnico comum:** o grupo estatístico e o TUSS estão na **Bronze**, não na Silver.
O pipeline Bronze→Silver precisa passar a **carregar `raw_codigo_grupo_estatistico` e o TUSS nativo**
(uma coluna cada), para a Gold aplicar as de-paras determinísticas sem join caro na leitura.

**Onde o LLM continua existindo:** só na tabela de referência `tuss_mappings_silver` (18.674 linhas,
com `mapping_source`/`confidence`). Ao adotar as fontes nativas acima, o dashboard **deixa de ler**
qualquer coluna derivada dessa tabela — a tabela pode continuar existindo para outros fins, mas
não alimenta mais a Sinistralidade 360.

---

## Veredito

O dashboard **não precisa** de LLM para nenhum número financeiro/operacional — esses já são nativos.
A dependência de IA está **restrita à rotulagem de evento/procedimento** e é **substituível por dado
nativo** em 6 dos 7 pontos. O único caso sem substituto nativo direto é o **agrupamento clínico de
internação (B5)**, que exige decisão de negócio (derivar de CID, agrupar por acomodação, ou remover).
