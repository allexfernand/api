# Feedback da reunião de negócio — análise e plano

Cada item do feedback foi mapeado ao componente/coluna real, investigado na base ao vivo,
e classificado por esforço, risco e dependência. **Nenhuma alteração foi feita ainda** —
este é o diagnóstico para decidir o que entra.

Legenda de esforço: 🟢 rápido (só UI) · 🟡 médio (API/mart) · 🔴 estrutural (linhagem/pipeline, decisão de negócio).

---

## A. Ajustes de apresentação (🟢 baixo risco, sem tocar dado)

| # | Feedback | O que é | Ação |
|---|---|---|---|
| A1 | "Tirar o período" | O texto "Período: jul/25 a jun/26" no cabeçalho de cada gráfico (`ChartCard`) | Remover/condensar o `periodLabel`. Trivial. |
| A2 | "Tirar a legenda e deixar só a atualização" | A legenda de cores dos gráficos; manter só a data de atualização | Confirmar **em quais** gráficos (legenda importa quando há >1 série; onde há 1 série pode sair). Cuidado com acessibilidade: identidade não pode ficar só na cor — manter rótulo direto ou tabela. |
| A3 | "Passar o mouse ver o indicador certo" | Tooltip mostrando o valor exato do ponto | Os SVG já têm `<title>` nativo; o pedido é um tooltip mais rico (crosshair). Média se for tooltip custom. |
| A4 | "Mudar nome de episódio pra internação" | Coluna "Episódios" na tabela Serviços e procedimentos | Renomear para "Internações". Trivial. (Ver nota B-crit sobre o que "internação" depende.) |
| A5 | "Deixar ele clicado" | Um bloco/gráfico deve vir aberto por padrão | Definir qual. Trivial (`defaultOpen`). |
| A6 | "Colocar um switch" | Alternador — no contexto, provavelmente o switch atendimento×competência (ver C1) | Depende de C1. |

---

## B. Dados e linhagem (🔴 decisão de negócio — impacto em cascata)

### B0 — "Voltar todas as linhas que foram removidas da Silver"  ⚠️ esclarecimento
**Investigação:** da Silver para a Gold **NÃO há remoção** — as duas têm exatamente 1.571.862 linhas.
A Gold é uma view 1:1. A única linha que sai é **1 (uma)**, e só na camada analítica dos marts:
`flag_data_suspeita = true` na linha com data de atendimento **ano 0205** (erro de digitação, R$ 2.760).
**Recomendação:** não há "linhas removidas" para voltar. Se o desejo é incluir até essa linha,
basta o mart não filtrar `flag_data_suspeita` — mas ela criaria um mês fantasma "0205-01" nas séries.
Alternativa correta: corrigir a data na origem (CNU) para ela cair no mês real. **Alinhar o entendimento com o time.**

### B1 — `tipo_evento`: "remover da Gold, usar coluna nativa da Bronze"  ⭐ achado relevante
**Investigação:** hoje `tipo_evento` é **enriquecido** (72% regra determinística, 25% LLM, 3% fallback).
A Bronze **tem sim** uma classificação nativa da operadora: `raw_nome_grupo_estatistico`
(via `raw_codigo_grupo_estatistico`). Amostra real:

| Código | Nome nativo | Linhas |
|---|---|---|
| DIG | Exame | 818.069 |
| MTC | Material Comum | 183.837 |
| MCM | Medicamento Comum | 161.466 |
| CEL | Consulta Eletiva | 133.766 |
| CUR | Consulta Urgência | 51.731 |
| TER | Terapia | 36.362 |
| … | (dezenas de códigos) | … |

**Implicação:** dá para trocar o `tipo_evento` inferido por essa classificação **nativa e auditável** —
elimina a dependência de LLM. **Porém a granularidade é diferente**: o grupo estatístico é mais fino
(separa "Material Comum", "Medicamento Comum", "Consulta Eletiva", "Consulta Urgência"), enquanto o
`tipo_evento` atual agrega ("Taxa/Mat/Med", "Consulta"). Seria preciso um **de-para grupo→evento**
(pequeno, determinístico) ou adotar as categorias nativas direto (muda os rótulos do gráfico).
**Não há grupo estatístico nativo para "Internação"** — internação hoje é derivada; ver B-crit.
**Recomendação:** trocar a fonte para `raw_nome_grupo_estatistico` é uma **melhoria de confiabilidade**.
Decidir: (a) manter os 12 rótulos atuais via de-para, ou (b) adotar a taxonomia nativa da operadora.

### B-crit — Dependência crítica: `flag_internacao`, event-mix e "evento principal" TODOS vêm de `tipo_evento`
**Investigação (Gold 002:140-142):** `flag_internacao = (tipo_evento = 'Internacao')`,
`flag_pronto_socorro = (tipo_evento = 'Pronto Socorro')`, `flag_terapia = (tipo_evento = 'Terapia')`.
Ou seja, **mudar a fonte do `tipo_evento` muda em cascata**:
- todo o bloco **Severidade / Internações** (episódios, saúde mental, agrupamentos);
- o gráfico **Composição por evento**;
- a coluna **Evento principal** do ranking de beneficiários (B4).

**Como o grupo estatístico nativo não tem "Internação"**, a flag de internação **não pode** vir dele —
teria que continuar derivada (de `raw_ind_internacao`/`raw_ind_internado`, que existem na Bronze — a validar)
ou de outra regra. **Este é o ponto de maior risco do pacote: tudo de internação depende dessa decisão.**

### B2 — "Evento principal na tabela beneficiário, se vier de `tipo_evento`, mudar"
**Investigação:** confirmado — `evento_principal` no `mart_pessoa_mes_v2` é o `tipo_evento` de maior custo
do mês da pessoa. Muda junto com B1. **Recomendação:** tratar junto de B1 (mesma fonte).

### B3 — "Remover o macrogroup que vem da Silver → tabela Serviços e procedimentos vai mudar"
**Investigação:** `macrogroup` está 99,7% preenchido e é **enriquecido** na Silver (mapeamento TUSS,
tabela `tuss_mappings_silver`). Alimenta a coluna "Grupo" da tabela de procedimentos e o rótulo do drawer.
**Recomendação:** se a decisão é não exibir dado enriquecido, remover a coluna "Grupo" da tabela
(a tabela continua com procedimento, serviços, custo — só perde o agrupamento). Alternativa: substituir
por `grupo_procedimento` (também da Silver, verificar se é nativo) ou pela descrição crua do procedimento.

### B4 — Severidade: "tirar os dados enriquecidos, tipo flag_internação"
**Investigação:** ver B-crit. `flag_internacao` é derivada de `tipo_evento`. Se "tirar enriquecido"
for regra geral, o bloco de internações **precisa de uma fonte nativa** (candidatos na Bronze:
`raw_ind_internacao`, `raw_ind_internado`, `raw_data_inicio_internacao`/`raw_data_alta`).
**Recomendação:** antes de remover, validar se essas colunas nativas identificam internação de forma
confiável; se sim, migrar a flag para elas (ganho de confiabilidade). Se não, manter e **sinalizar como derivado**.

---

## C. Gráficos específicos (🟡 médio — API/mart)

### C1 — Evolução mensal por COMPETÊNCIA + switch  ⭐ pedido central
**Feedback:** "em maio pagamos 14 milhões de sinistros passados; mostrar o gasto da competência,
não só do sinistro do mês". Hoje a evolução é por **data de atendimento** (quando o serviço ocorreu).
O negócio quer também por **competência de pagamento** (quando foi faturado/pago).
**Investigação:**
- `data_cobranca` só tem **5,7%** de preenchimento → **não serve**.
- `competencia_cobranca` tem **100%** (formato `dd/mm/aaaa`, dia de fechamento). **É o campo correto.**
- Diferença real e grande: por atendimento, mai/26 = R$ 1,57 mi (mês ainda "enchendo");
  por competência, os meses fechados ficam ~R$ 9–10 mi cada. Confirma a fala da reunião.
**Recomendação:** adicionar um **switch "Data de atendimento ↔ Competência de pagamento"** na
evolução mensal, calculando a série por `competencia_cobranca` quando selecionado. É o item A6 ("switch").
Esforço médio (nova agregação no mart/API); alto valor para o negócio.

### C2 — Volume × custo médio (dispersão): clicar na bolha + tirar a deformação  ⭐ conecta ao "2 milhões de serviços"
**Investigação:** a deformação vem das linhas de **material/medicamento com `quantidade_servicos` gigante**
(ex.: 5.000 unidades num registro) — 5.129 linhas (0,6%) geram 45% dos "serviços". Elas esticam o eixo de volume.
**Recomendação:** (a) permitir **clicar na bolha** para abrir o detalhe/utilização do item (drill-down);
(b) tratar o outlier — opções: eixo logarítmico, excluir material/medicamento do gráfico de dispersão,
ou usar **linhas de cobrança** em vez de `quantidade_servicos` como eixo de volume. Recomendo separar
"serviços clínicos" de "unidades de insumo" (liga-se a B1/grupo estatístico).

### C3 — Mais filtros na evolução dos maiores procedimentos
**Feedback:** adicionar filtros ao gráfico de série dos top procedimentos.
**Recomendação:** definir os filtros desejados (por evento? por grupo? por prestador?). O scope
`procedure-trends` já aceita `event_type`; dá para expor mais dimensões. Médio.

### C4 — "Leitura do último mês da janela" → últimos 2 meses
**Investigação:** o card de concentração hoje resume só o último mês (`monthly.at(-1)`).
**Recomendação:** exibir os **2 últimos meses** lado a lado (ou média dos 2), suavizando o efeito de
mês parcial. Baixo/médio esforço (o dado dos meses já vem no payload).

### C5 — População, Família e coordenação: "melhorar ou remover"
**Investigação:** é a seção mais conceitual (dois gráficos: coorte antes/depois da entrada + quadrantes
fatura×coordenação). Depende de dados de outra base (atendimento/HealthCoach) cruzados por CPF do titular,
com limitação conhecida de ponte familiar de dependentes. Foi o bloco que gerou mais dúvida.
**Recomendação:** decisão de produto. Se mantiver, simplificar para **uma** pergunta clara
("quantas pessoas usaram o plano sem acompanhamento da Sanus?") e rotular os quadrantes com tooltip.
Se o cruzamento não for confiável o suficiente para negócio, **remover** até a ponte familiar melhorar.

---

## Resumo executivo para decisão

**Decisões de negócio necessárias antes de codar:**
1. **Dado enriquecido vs nativo** (B1, B2, B3, B4): trocar `tipo_evento`/`macrogroup`/`flag_internacao`
   por colunas nativas da Bronze é uma melhoria de confiabilidade, **mas** `tipo_evento` governa todo o
   bloco de internação e o event-mix — precisa de fonte nativa para "internação" (candidatas existem, a validar).
   Definir: adotar taxonomia nativa da operadora ou de-para para os rótulos atuais.
2. **Competência (C1)**: aprovado tecnicamente — usar `competencia_cobranca` (100% preenchida). Alto valor.
3. **"Linhas removidas" (B0)**: baseado em mal-entendido — só 1 linha (data impossível) é filtrada. Alinhar.
4. **Família e coordenação (C5)**: manter simplificado ou remover.

**Rápido e independente (pode ir já):** A1 (período), A2 (legenda), A3 (tooltip), A4 (episódio→internação),
A5 (default aberto), C4 (2 meses).

**Depende de decisão/dados:** B1–B4 (linhagem), C1 (competência), C2 (dispersão), C3 (filtros), C5 (família).
