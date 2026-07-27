# Sinistralidade · Camada de Dados

Documento de referência da camada de dados que alimenta o dashboard (Sinistralidade 360 e Análise Sinistro),
consolidado após a auditoria e as correções de 2026-07-20. Cobre a linhagem completa
(Silver → Gold v2 → marts → API → UI), o dicionário de cada view, as métricas e agregações,
e o veredito de coerência com as evidências dos gates executados em produção.

---

## 1. Linhagem

```
utilizacao_silver_final (Delta, 1.571.862 linhas — dado cru da operadora CNU)
        │  reconciliação 1:1 (linhas e custo ao centavo — gates 005/006)
        ▼
gold_sinistro_evento_v2 (VIEW · 1 linha = 1 linha de cobrança)
        │  chaves opacas + flags + classificação + NOT flag_data_suspeita nos marts
        ▼
21 marts *_v2 (VIEWS — recalculam da Gold a cada consulta, nada materializado)
        │  filtrados por company_key + month_key da janela aprovada pelo gate
        ▼
API /api/sinistralidade/v2 (scopes) e /api/gold-preview
        │  agregações de janela, gate de período, mascaramento, supressão
        ▼
Dashboard (Sinistralidade 360 · Análise Sinistro · abas legadas)
```

Governança paralela (tabelas Delta, as únicas com estado):

| Tabela | Papel | Estado em 2026-07-20 |
|---|---|---|
| `sinistralidade_month_status_v2` | Gate de fechamento (`closed`/`partial`/`unknown`) | 128 empresa-meses, todos `unknown` — nenhum mês fechado |
| `sinistralidade_ingestion_manifest_v2` | Inventário de arquivos recebidos | 759 arquivos `observed_unapproved` |
| `sinistralidade_quality_run_v2` | Resultado dos gates | `longitudinal-baseline-2026-07-20-admissao`: 10/10 passed |
| `beneficiary_eligibility_snapshot_v2` | Snapshot mensal de vidas elegíveis | Sem meses com denominador → métricas "por vida" ficam NULL |
| `sinistralidade_company_alias_v2` | Aliases de empresa | 4 empresas (grupo Azul/CNU) |

A Gold **v1** (`gold_sinistro_evento` + `gold_sinistro_*_mes`) foi aposentada em 2026-07-20:
4 views removidas (backup em `databricks/sinistralidade/legacy/gold_v1_views_backup.sql`);
`gold_sinistro_evento` aguarda DROP pelo owner do workspace. A aba Análise Sinistro (ex-PREVIEW-gold, consolidada em React sobre a Gold) consome a v2.

---

## 2. Gold v2 — colunas relevantes

`gold_sinistro_evento_v2` (grão: linha de cobrança), destaques:

- **Identidade opaca**: `company_key`, `operator_key`, `person_key`, `family_key` (hash SHA-256; sem CPF/nome/carteirinha),
  `identity_resolution_method` (inclui reconstrução do lote corrompido 042026, ~98% match único).
- **Episódio**: `episode_key` = hash(empresa, pessoa, conta, senha, **data**, prestador) — grão **atendimento-dia**.
  A internação clínica é a **admissão** (mesmo hash **sem** a data), derivada nos marts.
- **Medidas**: `custo_assistencial_bruto` (= `Sinistro`), `valor_coparticipacao`, `custo_liquido_aproximado`,
  `quantidade_servicos`, `duracao_internacao_dias`.
- **Flags**: `flag_internacao`, `flag_saude_mental`, `flag_pronto_socorro`, `flag_reembolso`,
  `flag_estorno` (Sinistro < 0), `flag_data_suspeita` (data < 2019 ou futura; NULL ⇒ suspeita).
- **Classificação**: `tipo_evento`, `macrogroup`, `grupo_procedimento`, `agrupamento_internacao`,
  `codigo_procedimento_operadora`, `tuss_code`, `codigo_cid_normalizado`, `prestador`, `tipo_prestador`, `especialidade`.
- **Demografia da linha**: `faixa_etaria_usuario`, `parentesco_usuario`, `genero_usuario`.
- **Tempo**: `data_atendimento`, `month_key` (YYYY-MM), `ingested_at`.

Todos os marts analíticos aplicam `WHERE NOT flag_data_suspeita` (1 linha excluída hoje: ano 0205, R$ 2.760).

---

## 3. Dicionário dos marts (o que alimenta cada bloco)

### 3.1 `mart_sinistro_empresa_mes_v2` — visão executiva mensal
Grão: empresa + mês. Alimenta: KPIs executivos, evolução mensal, visão legada, seletor de mês.

| Coluna | Definição |
|---|---|
| `linhas_cobranca` | `count(*)` |
| `quantidade_servicos` | `sum(quantidade_servicos)` |
| `utilizantes` | `count(DISTINCT person_key)` no mês |
| `familias_utilizantes` | `count(DISTINCT family_key)` |
| `custo_assistencial_bruto` | `sum(Sinistro)` (líquido de estornos por natureza) |
| `coparticipacao` / `custo_liquido_aproximado` | soma da copart / custo − copart |
| `participacao_custo_mes` | custo da empresa ÷ custo do mês na operadora (fração 0–1) |
| `vidas_elegiveis` | `sum(member_month_weight)` do snapshot contemporâneo — **vida-mês**; `NULL` sem snapshot (nunca 0) |
| `custo_por_vida_elegivel` | custo ÷ vidas-mês (`nullif`); NULL propaga |
| `freshness` | `max(ingested_at)` |

### 3.2 `mart_evento_empresa_mes_v2` — composição por tipo de evento
Grão: empresa + mês + `tipo_evento`. Alimenta: gráfico de composição (colunas empilhadas, Top 5 + "Demais").
Colunas: linhas, serviços, `utilizantes` (distinto no mês/evento), `familias_utilizantes`,
`episodios_internacao` (**admissões**), custo, `custo_saude_mental`, `participacao_custo_mes` (fração).

### 3.3 `mart_pessoa_mes_v2` — base longitudinal do beneficiário
Grão: empresa + mês + `person_key`. Alimenta: ranking de maiores utilizantes, sparklines, drawer individual, KPIs de janela.
Colunas: linhas, serviços, custo, `episodios_internacao` (**admissões** que tocam o mês), `eventos_distintos`,
`prestadores_distintos`, `custo_saude_mental`, `custo_reembolso`, `faixa_etaria`, `parentesco`, `genero`,
`possui_cid_valido`, `evento_principal` (evento de maior custo do mês, desempate determinístico), `family_key`.

### 3.4 `mart_procedimento_mes_v2` — procedimentos/serviços
Grão: empresa + mês + `procedimento_key` (código da operadora). Alimenta: ranking, Pareto, série dos Top-N, crescimento.
Colunas: `descricao_comercial`, `grupo_comercial`, `grupo_procedimento`, linhas, serviços,
`utilizantes` (distinto no mês — somado na janela vira **utilizante-mês**), `episodios_internacao` (admissões),
custo, `custo_medio_por_servico` (custo ÷ serviços, `nullif`).

### 3.5 `mart_internacao_mes_v2` — internações × saúde mental
Grão: empresa + mês (da **admissão**, = primeiro mês observado) + `saude_mental`.
A classificação SM é no grão de admissão: qualquer linha SM ⇒ admissão inteira SM (sem split).

| Coluna | Definição |
|---|---|
| `episodios_internacao` | `count(DISTINCT admission_key)` — **admissões clínicas** |
| `atendimentos_dia` | contagem antiga por `episode_key` (mantida para reconciliar; razão hoje: 1,65 na AZUL) |
| `utilizantes` | pessoas distintas com admissão |
| `custo_total` / `custo_medio_por_episodio` | soma ÷ admissões (`nullif`) |
| `duracao_mediana_dias` / `duracao_p90_dias` | percentis da duração (max por admissão) |
| `cobertura_duracao` | fração de admissões com duração informada |

### 3.6 `mart_internacao_grupo_mes_v2` — agrupamento clínico
Idem 3.5 com grão empresa + mês + `agrupamento_internacao` (dominante por custo dentro da admissão).
`prestadores_envolvidos` conta prestadores por admissão (1 por construção da chave).

### 3.7 `mart_prestador_mes_v2` — prestadores e rede × reembolso
Grão: empresa + mês + `prestador_key` (hash de empresa+nome) + `reembolso`.
Colunas: `prestador_label`, `tipo_prestador`, `especialidade_principal`, linhas, serviços, utilizantes,
`episodios_internacao` (admissões), custo, `ticket_medio_por_servico`, `custo_medio_por_utilizante`.

### 3.8 `mart_concentracao_mes_v2` — concentração do custo
Grão: empresa + mês. Toda a matemática vive aqui (a API é passthrough):

- `participacao_top1/top5/top10` = custo do Top-N ÷ custo total do mês (frações 0–1).
- `participacao_top10pct` = Top `greatest(1, ceil(10% das pessoas))`.
- `pessoas_para_50pct/80pct` = menor rank cujo acumulado ≥ 50%/80% do custo.
- `top10_recorrentes_mes_anterior` = interseção do Top 10 com o Top 10 do mês observado anterior.
- **Estornos**: pessoas com custo líquido ≤ 0 no mês ficam fora do *ranking* (acumulado monotônico);
  `custo_total`/`pessoas_utilizantes` continuam completos e reconciliam com a Gold.

### 3.9 `mart_ps_item_mes_v2` (sobre `mart_ps_episodio_item_v2`) — pronto-socorro
Grão: empresa + mês + item. Só itens de episódios com PS observado (associação explícita, gate 009).
`episodios_ps`, utilizantes, linhas, serviços, custo, `quantidade_por_episodio`.
Um episódio contém vários itens — somas por item ≠ episódios únicos (nota na UI).

### 3.10 `mart_familia_mes_relativo_v2` — coorte familiar antes/depois
Grão: empresa + coorte de entrada + `mes_relativo` (−12..+12 da entrada do grupo familiar).
Famílias, pessoas, serviços, admissões, custo e evento principal por mês relativo.
Limitação estrutural: dependentes sem ponte familiar (family_key NULL na elegibilidade) não entram —
a utilização deles fica subatribuída ao titular (documentado; sem fanout de custo).

### 3.11 `mart_coordenacao_empresa_mes_v2` + `mart_fatura_coordenacao_v2` — fatura × coordenação
Quadrantes `utilizou_plano × teve_coordenacao` por mês (pessoas, famílias, titulares, dependentes,
custo, eventos de coordenação, `pessoas_sem_ponte_familiar`) + recortes demográficos (sexo, vínculo, estado)
no nível de pessoa. Base dirigida por **elegibilidade** (não reconcilia com a Gold por timing de snapshot — documentado).

### 3.12 Marts legados 1.0.0 (aba antiga / LegacyView)
`mart_top10_mes_v2`, `mart_top10_bimestre_v2` (entrega ranking completo; o corte ≤10 é do consumidor),
`mart_saude_mental_internacao_v2` (reescrita no grão de admissão em 2026-07-20 — mesma verdade da 360),
`mart_familia_antes_depois_v2`, `mart_comparativo_semestral_v2` (`sinistros` = linhas de cobrança;
coluna explícita `linhas_cobranca` adicionada).

---

## 4. O que a API calcula em cima dos marts

O gate de período roda **antes** de qualquer cálculo (`period-gate.ts`): resolve a janela
(`end_month` + `window_months`), classifica cada mês (`closed`/`partial`/`unknown`) e só libera
meses aprovados. `include_partial=false` sem mês fechado ⇒ **blocked** (409). Benchmark usa o
status agregado das empresas do escopo (fechado só se todas fecharam).

| Métrica na tela | Onde é calculada | Fórmula |
|---|---|---|
| KPIs da janela (custo, serviços, admissões) | API (`timeline.ts`) | soma dos meses aprovados |
| Utilizantes/famílias da janela | API | `count(DISTINCT person_key/family_key)` **na janela inteira** (nunca soma de meses) |
| Custo por utilizante (KPI) | API | custo da janela ÷ pessoas distintas |
| Custo por utilizante-mês (benchmark/procedimentos) | API | custo ÷ **soma de utilizantes mensais** (pessoa conta por mês — rotulado na UI) |
| Custo por vida / internações por mil | API | custo ÷ `sum(vidas_elegiveis)` (**vida-mês/PMPM**); só quando TODOS os meses têm denominador, senão `not_comparable` |
| Variação M/M e A/A | API (`growth`) | `(atual − base) ÷ |base| × 100`; base 0 ⇒ `new`, base ausente ⇒ `not_comparable` — **nunca divide por zero** |
| Média móvel 3m | API | média dos 3 meses; qualquer buraco ⇒ `null` |
| Pareto / % acumulado | API | acumulado ÷ total da janela (fração 0–1) |
| Delta de posição no ranking | API | rank na janela atual − rank na janela imediatamente anterior (mesmo tamanho) |
| Concentração | mart (passthrough) | ver §3.8 |
| Séries densas por entidade | API | mês coberto sem consumo = **0**; mês sem cobertura da empresa = **`null`** |

Convenção de unidades: shares/participações = **frações (0–1)**; variações M/M–A/A = **percentuais (0–100)**.
O mapa `units` de cada scope declara isso por campo.

Privacidade aplicada no servidor (nunca só no front): `person_key` mascarado no rótulo
(`Beneficiário xxxxxxxx`), supressão de contagens 0<n<5 para perfil externo (MDS) **em cascata**
(célula suprimida não expõe custo), acesso individual gated por permissão e auditado
(inclusive tentativas 404), MDS nunca recebe nível individual.

---

## 5. Coerência e veracidade — evidências

Tudo abaixo foi **executado em produção em 2026-07-20** (gates 009 + baseline 010):

| Verificação | Resultado |
|---|---|
| Reconciliação Silver ↔ Gold v2 (linhas e custo) | ✅ idênticos (1.571.862 linhas; custo ao centavo) |
| Grão único dos 10 marts longitudinais | ✅ zero duplicatas |
| Custo por empresa/mês: evento, pessoa, procedimento, prestador ↔ Gold | ✅ tolerância R$ 0,05, zero divergências |
| Custo de internação e de itens de PS ↔ Gold | ✅ zero divergências |
| Pessoas e admissões ↔ cálculo direto na Gold | ✅ idênticos |
| Participações somam 100% por empresa/mês | ✅ |
| Concentração monotônica (top1 ≤ top5 ≤ top10 ≤ 100%; p50 ≤ p80) | ✅ |
| Densidade da série (mês na Gold ⇒ mês nos marts) | ✅ |
| Associação PS e denominadores de elegibilidade | ✅ |
| Gold v1 × marts v2 (última reconciliação antes da aposentadoria) | ✅ R$ 0,00 em 72/73 meses; exceção = linha de data suspeita (R$ 2.760), excluída por design |

Correções de veracidade aplicadas nesta rodada:

1. **Internações**: 18.173 "episódios" (atendimento-dia) → **11.054 admissões clínicas** (−39%).
   O número antigo era inflado; `atendimentos_dia` segue disponível e o check `admission_vs_day_ratio` monitora a razão.
2. **Saúde mental legada**: mesma admissão não é mais contada em SM *e* não-SM.
3. **Sem zeros falsos**: mês sem cobertura vira `null` em toda série (contrato "ausência nunca vira zero").
4. **Concentração** imune a estornos (que hoje são ~0% da carteira — monitorado).

### Limitações honestas (dados verdadeiros, mas com fronteiras conhecidas)

- **Nenhum mês formalmente fechado** — todo número exibido é "observado (parcial)", sinalizado na UI.
  Fechamento é ato de negócio via `close-month` (manifest + reconciliação), nunca automático.
- **Sem snapshots de elegibilidade** — "custo por vida" e "internações por mil vidas" ficam NULL
  (correto: sem denominador não se inventa). "Custo por vida" quando existir será **por vida-mês (PMPM)**.
- **Admissão depende de conta/senha da origem** — se a operadora omitir esses campos, a chave degrada
  para pessoa+prestador (razão do check 3c no 009).
- **Ponte familiar de dependentes ausente na origem** — análises familiares subcontam dependentes (sinalizado).
- **Cobertura de CID baixa** (ex.: 17% em ago/2023) — por isso nenhum scope expõe diagnóstico; TUSS ~98,5% e
  flag de saúde mental ~98% (agora medidos no `coverage_report`).
- **Não é sinistralidade financeira**: custo bruto por data de atendimento, sem prêmio na base — não é loss ratio.

### Veredito

Com os gates verdes em produção, **os números exibidos pelo dashboard são coerentes entre si e
reconciliam com a fonte** em todas as dimensões auditadas. As distorções encontradas na auditoria
(internações infladas, dupla contagem de saúde mental, zeros falsos, benchmark bloqueado) foram
corrigidas e passaram a ser vigiadas por checks permanentes. O que o dado ainda **não** sustenta
(fechamento formal, denominadores por vida, diagnóstico clínico) o sistema declara explicitamente
em vez de estimar.

---

## 6. Operação

```bash
# Homologação (objetos *_hml dentro de sanus_prod)
npm run databricks:sinistralidade:plan          # dry-run
npm run databricks:sinistralidade:apply         # aplica em *_hml
node scripts/validate-sinistralidade-hml.mjs    # gates 009 na homologação

# Produção (após homologação verde; atualizar o run id do 010 antes)
SINISTRALIDADE_TARGET_SUFFIX="" npm run databricks:sinistralidade:apply
SINISTRALIDADE_TARGET_SUFFIX="" node scripts/validate-sinistralidade-hml.mjs
```
