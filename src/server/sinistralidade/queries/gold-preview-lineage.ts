// Linhagem dos blocos da aba Análise Sinistro (/api/gold-preview).
//
// ATENÇÃO — co-locação mais fraca que nas demais entradas do registro. O SQL
// que estas entradas descrevem mora em src/server/routes/gold-preview.ts, não
// neste arquivo. Foi decisão consciente: aquele arquivo já tem ~600 linhas e
// as entradas somariam ~300. Quem alterar uma consulta lá precisa revisar a
// entrada correspondente aqui — o teste de coluna fabricada em
// tests/unit/sinistralidade-lineage.test.ts aponta estas entradas para o
// arquivo da rota e pega nome de coluna inexistente, mas não pega uma coluna
// que existe e deixou de ser usada.

import type { LineageEntry } from "../../../contracts/sinistralidade-v2";
import { TABLES } from "../query-runner";

const ESCOPO_USUARIO = "company_key do escopo do usuário, aplicado no SQL";
const NOT_SUSPEITA = "NOT flag_data_suspeita";
const FILTROS_OPCIONAIS =
  "filtros opcionais de faixa etária, sexo, tipo de plano, cidade/estado e serviço Sanus, aplicados quando ativos na tela";

// O filtro opcional de cidade/estado (facetas do usuário) não é um WHERE
// literal: a rota resolve family_key contra o snapshot de elegibilidade ANTES
// de aplicar o filtro principal na Gold. Toda consulta desta rota que aceita
// o filtro do usuário herda essa subconsulta quando o usuário escolhe
// cidade/estado — por isso vira fonte própria, e não só uma linha de texto em
// `filters`, nas entradas cuja consulta aceita esse filtro.
const FONTE_FILTRO_CIDADE_ESTADO = {
  object: TABLES.eligibilitySnapshot,
  role: "resolve family_key quando o filtro opcional de cidade/estado do usuário está ativo (subconsulta dentro do filtro aplicado no SQL)",
  columns: ["family_key", "city", "state"],
};

export const GOLD_PREVIEW_LINEAGE: LineageEntry[] = [
  {
    id: "claims.freshness",
    kind: "block",
    label: "Selo de atualização: versão e timestamp da Silver",
    layer: "silver",
    sources: [
      {
        object: TABLES.silverFinal,
        role: "DESCRIBE HISTORY da Silver de sinistro — não alimenta nenhum KPI ou gráfico da aba; fornece só a versão e o timestamp Delta exibidos no cabeçalho, ao lado dos blocos que leem a Gold.",
        columns: ["version", "timestamp"],
      },
    ],
    formula:
      "delta_version = version mais recente do histórico Delta de utilizacao_silver_final (DESCRIBE HISTORY ... ORDER BY version DESC LIMIT 1); delta_timestamp = timestamp dessa mesma versão.",
    filters: [],
    notes: [
      "Esta entrada existia como lacuna consciente: a Silver não tinha consumidor nenhum na aba até o cabeçalho (Task 4) passar a exibir a versão Delta. TABLES.silverFinal foi adicionada só quando esse consumidor passou a existir.",
      "delta_version/delta_timestamp descrevem quando a SILVER foi atualizada pela última vez (ingestão manual, sem agenda — ver docs/sinistralidade/ARQUITETURA_DATABRICKS.md), não quando a página foi renderizada nem quando a Gold (view, recalculada a cada consulta) foi lida.",
    ],
    related: ["claims.kpis"],
  },
  {
    id: "claims.kpis",
    kind: "block",
    label: "KPIs executivos da Análise Sinistro",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "custo, utilizantes e reembolso agregados na janela de até 12 meses fechados ou observados",
        columns: ["month_key", "person_key", "custo_assistencial_bruto", "flag_reembolso", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.gold,
        role: "série mensal bruta usada para decidir qual é o último mês fechado",
        columns: ["month_key", "person_key", "custo_assistencial_bruto", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "sinistro_12m = SUM(custo_assistencial_bruto) na janela de até 12 meses; utilizantes_12m = COUNT(DISTINCT person_key) na mesma janela; custo_por_utilizante_12m = sinistro_12m ÷ utilizantes_12m; reembolso_share_12m = SUM(custo com flag_reembolso) ÷ sinistro_12m × 100. Sem mês fechado, o card de sinistro usa o último mês observado e o de utilizantes usa a janela observada.",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "mês é considerado fechado pelo status mais recente em sinistralidade_month_status_v2 para todas as empresas observadas no escopo; sem mês fechado, a rota usa a janela observada e a marca como não oficial",
    ],
    notes: [
      "O fechamento é conservador para o escopo: um mês só é fechado quando todas as empresas observadas nele têm status closed. Caso contrário, a interface mostra valores observados com sinalização explícita.",
      "Em período observado, utilizantes_12m é o COUNT DISTINCT person_key de toda a janela; no período fechado, o card de utilizantes usa a última competência fechada.",
    ],
    related: ["claims.monthly"],
  },
  {
    id: "claims.monthly",
    kind: "block",
    label: "Série mensal de sinistro por data de atendimento",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "fato principal, agregado por mês de atendimento",
        columns: ["month_key", "person_key", "custo_assistencial_bruto", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Uma linha por mês desde 2025-01: sinistro = SUM(custo_assistencial_bruto); utilizantes = COUNT(DISTINCT person_key); itens = COUNT(*).",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "meses com sinistro abaixo de R$ 100.000 são descartados da série (lag residual); os meses mais recentes acima do piso ficam marcados como parcial",
    ],
    notes: [
      "Responde quanto foi ATENDIDO no mês (eixo month_key = data do atendimento). Ver claims.competency para a série por faturamento.",
      "É a mesma fonte usada por claims.quarterly, que agrega esta série em trimestres no cliente, sem consulta própria.",
    ],
    related: ["claims.competency", "claims.quarterly", "claims.kpis"],
  },
  {
    id: "claims.competency",
    kind: "block",
    label: "Série mensal de sinistro por competência de cobrança",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "fato principal, agregado pela competência de cobrança",
        columns: ["competencia_cobranca", "custo_assistencial_bruto", "quantidade_servicos", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Converte competencia_cobranca de dd/MM/yyyy para yyyy-MM e agrupa: sinistro = SUM(custo_assistencial_bruto); servicos = SUM(quantidade_servicos); linhas = COUNT(*).",
    filters: [ESCOPO_USUARIO, NOT_SUSPEITA, FILTROS_OPCIONAIS],
    notes: [
      "Responde quanto foi FATURADO no mês; difere da série por atendimento (claims.monthly) pelo lag de cobrança.",
      "Ao contrário de claims.monthly, não tem piso de sinistro nem meses marcados como parcial: toda competência a partir de 2025-01 aparece.",
      "linhas (COUNT(*)) e servicos (SUM(quantidade_servicos)) são dois números de volume diferentes; claims.monthly só tem itens (COUNT(*)), sem equivalente a servicos.",
    ],
    related: ["claims.monthly"],
  },
  {
    id: "claims.quarterly",
    kind: "block",
    label: "Série trimestral de sinistro (derivada da série mensal)",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "mesma fonte de claims.monthly; sem consulta própria nesta rota",
        columns: ["month_key", "person_key", "custo_assistencial_bruto", "flag_data_suspeita", "company_key"],
      },
    ],
    formula:
      "Sem agregação no servidor: agrupa três meses consecutivos da série de claims.monthly e soma sinistro e itens no cliente; utilizantes do trimestre é a MÉDIA mensal, não a soma.",
    filters: ["os mesmos filtros de claims.monthly, por ser a mesma fonte — nenhum filtro adicional é aplicado aqui"],
    notes: [
      "Este bloco não tem consulta própria em gold-preview.ts: os números trimestrais são agregados no cliente a partir da série mensal (claims.monthly), sem nenhum SELECT dedicado no servidor. Utilizantes aparece como média mensal, não soma, porque somar contaria a mesma pessoa mais de uma vez entre os meses do trimestre.",
      "Qualquer alteração na consulta que alimenta claims.monthly se propaga para este bloco sem mudança de código nesta entrada.",
    ],
    related: ["claims.monthly"],
  },
  {
    id: "claims.event-mix",
    kind: "block",
    label: "Composição do custo por tipo de evento",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "quando há filtro de usuário ativo — o mart abaixo não tem as colunas de filtro",
        columns: ["month_key", "tipo_evento", "custo_assistencial_bruto", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.martEventoMes,
        role: "quando não há filtro de usuário ativo (via mais barata)",
        columns: ["month_key", "tipo_evento", "custo_assistencial_bruto", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Sinistro por tipo_evento em cada mês desde 2025-01: SUM(custo_assistencial_bruto) agrupado por (month_key, tipo_evento).",
    filters: [ESCOPO_USUARIO, NOT_SUSPEITA + " (só na via Gold)", FILTROS_OPCIONAIS + " (só se aplicam à via Gold)"],
    notes: [
      "Duas fontes alternativas para o mesmo número: com qualquer filtro de usuário ativo, a rota cai para a Gold v2 linha a linha, porque mart_evento_empresa_mes_v2 não tem colunas de faixa etária/sexo/tipo de plano/cidade/estado/serviço Sanus; sem filtro, usa o mart pré-agregado.",
      "tipo_evento vazio ou nulo aparece como 'Sem classificação' nas duas vias.",
    ],
    related: ["claims.monthly"],
  },
  {
    id: "claims.locations",
    kind: "block",
    label: "Sinistro por lotação",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "fato principal, agregado por lotação, limitado às 12 maiores",
        columns: ["nome_lotacao", "custo_assistencial_bruto", "person_key", "month_key", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Por nome_lotacao: sinistro = SUM(custo_assistencial_bruto); beneficiarios = COUNT(DISTINCT person_key); share = sinistro da lotação ÷ sinistro somado de TODAS as lotações (antes do corte para 12).",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "janela fixa desde 2024-01 (JANELA_2024), diferente da janela de 12 meses fechados de claims.kpis/claims.concentration",
      "somente as 12 lotações de maior sinistro aparecem na resposta",
    ],
    notes: [
      "Lotação vazia ou nula aparece como 'Sem lotação'. Quando essa barra domina o ranking, o problema é ausência do dado NA ORIGEM (cadastro do RH/operadora), não do cálculo aqui.",
      "share é calculado sobre o total de TODAS as lotações antes do corte para 12: a soma dos shares exibidos pode não fechar em 100%.",
    ],
    related: ["claims.providers"],
  },
  {
    id: "claims.concentration",
    kind: "block",
    label: "Concentração do sinistro nos maiores utilizantes",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "custo por pessoa na janela de 12 meses fechados, para ranquear e medir concentração",
        columns: ["person_key", "custo_assistencial_bruto", "month_key", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Ranqueia pessoas por SUM(custo_assistencial_bruto) na janela; top1_pessoas = CEIL(1% do total de utilizantes); top1_share = custo somado do 1% mais caro ÷ custo total × 100; top5_share = idem para o 5% mais caro.",
    filters: [ESCOPO_USUARIO, NOT_SUSPEITA, FILTROS_OPCIONAIS, "janela de 12 meses fechados (mesma janela de claims.kpis)"],
    notes: [
      "Apesar do nome, top1_pessoas NÃO é a pessoa nº 1: é CEIL(1% do total de utilizantes da janela), o tamanho do grupo Top 1%. Não confundir com o mart mart_concentracao_mes_v2 da Visão 360 (concentration.monthly), cujo participacao_top1 é, esse sim, a pessoa isolada nº 1 — nomes parecidos, perguntas diferentes.",
      "Só agregados. Nenhuma identificação individual sai deste bloco.",
    ],
    related: ["claims.top-users", "claims.providers"],
  },
  {
    id: "claims.providers",
    kind: "block",
    label: "Sinistro por prestador",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "quando há filtro de usuário ativo — o mart abaixo não tem as colunas de filtro",
        columns: ["prestador", "custo_assistencial_bruto", "month_key", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.martPrestadorMes,
        role: "quando não há filtro de usuário ativo (via mais barata)",
        columns: ["prestador_label", "custo_assistencial_bruto", "month_key", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Top 10 prestadores por SUM(custo_assistencial_bruto) desde 2024-01; share de cada um = sinistro do prestador ÷ sinistro somado de TODOS os prestadores (antes do corte para 10).",
    filters: [ESCOPO_USUARIO, NOT_SUSPEITA + " (só na via Gold)", FILTROS_OPCIONAIS + " (só se aplicam à via Gold)"],
    notes: [
      "A coluna do nome do prestador muda de nome entre as duas vias: prestador na Gold direta, prestador_label no mart. Não é a mesma coluna com apelido diferente por acaso — são consultas distintas.",
      "share é calculado sobre o total de TODOS os prestadores antes do corte para 10.",
    ],
    related: ["claims.locations", "claims.concentration"],
  },
  {
    id: "claims.hospitalization",
    kind: "block",
    label: "Internações por agrupamento e estatísticas de episódio",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "sinistro de internação por agrupamento de acomodação, em milhões",
        columns: ["acomodacao_internacao", "custo_assistencial_bruto", "flag_internacao", "month_key", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.gold,
        role: "estatísticas por episódio contínuo, inclusive comparação por sinal de saúde mental e reembolso",
        columns: ["person_key", "data_inicio_internacao", "data_alta", "episode_key", "custo_assistencial_bruto", "duracao_internacao_dias", "flag_internacao", "flag_saude_mental", "flag_reembolso", "month_key", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "por_agrupamento: SUM(custo_assistencial_bruto) ÷ 1.000.000 agrupado por acomodacao_internacao (top 8); episódio = período contínuo por empresa e pessoa: intervalos sobrepostos ou com alta e novo início na mesma data são unidos; a comparação com sinal de saúde mental classifica o episódio inteiro quando qualquer linha dele tem flag_saude_mental=true. Mostra episódios, beneficiários, custo, ticket, duração mediana/p90, cobertura de duração e custo de reembolso por grupo.",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "somente eventos com flag_internacao",
      "janela fixa desde 2024-01 (JANELA_2024), diferente da janela de 12 meses fechados de claims.kpis",
    ],
    notes: [
      "A mesma consolidação por período contínuo do mart_internacao_mes_v2 é derivada na Gold para preservar os filtros desta aba. Linhas sem as duas datas usam a chave de admissão como fallback.",
      "Reembolso é somado nas linhas marcadas dentro de cada episódio; não transforma todo o episódio em reembolso quando ele mistura rede e reembolso.",
      "Acomodação vazia ou nula aparece como 'Outras diárias'; é uma classificação de acomodação, não um agrupamento clínico homologado.",
    ],
    related: ["claims.mental-health"],
  },
  {
    id: "claims.mental-health",
    kind: "block",
    label: "Saúde mental: share do custo e temas",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "custo, beneficiários, serviços e reembolso de eventos sinalizados como saúde mental",
        columns: ["custo_assistencial_bruto", "quantidade_servicos", "person_key", "flag_saude_mental", "flag_reembolso", "month_key", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.gold,
        role: "temas de saúde mental por custo, participação, beneficiários e serviços",
        columns: ["tema_saude_mental", "custo_assistencial_bruto", "quantidade_servicos", "person_key", "flag_saude_mental", "month_key", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "share_flag = SUM(custo com flag_saude_mental = true) ÷ SUM(custo total) × 100; custo, beneficiários e serviços usam somente eventos sinalizados; reembolso_share = custo de linhas sinalizadas e marcadas como reembolso ÷ custo sinalizado; por_tema traz os 5 maiores temas por custo, com participação dentro do custo sinalizado.",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "janela fixa desde 2024-01 (JANELA_2024), mais ampla que a janela de 12 meses fechados de claims.kpis",
    ],
    notes: [
      "Na Gold v2 a flag é booleana: o card mostra participação exata, não um intervalo de incerteza.",
      "A flag usa critérios determinísticos e códigos nativos; é um sinal analítico de saúde mental, não diagnóstico clínico.",
      "Tema vazio ou nulo aparece como 'Sem tema'.",
    ],
    related: ["claims.hospitalization"],
  },
  {
    id: "claims.sanus-impact",
    kind: "block",
    label: "Impacto Sanus: janelas pareadas pré/pós",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "itens, sinistro, utilizantes e mudança por tipo de evento nas janelas pareadas 2×2, 4×4 e 6×6",
        columns: ["month_key", "custo_assistencial_bruto", "person_key", "tipo_evento", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.gold,
        role: "utilizantes distintos por trimestre calendário, desde 2025-07",
        columns: ["month_key", "person_key", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Cada seletor compara 2, 4 ou 6 meses antes contra o mesmo número depois, com corte em out/2025. Em cada lado: itens = COUNT(*), sinistro = SUM(custo_assistencial_bruto), utilizantes = COUNT(DISTINCT person_key); eventos compara COUNT(*) para Pronto Socorro, Internação, Consulta e Terapia; trimestres_utilizantes = COUNT(DISTINCT person_key) por trimestre.",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "janelas de calendário fixas no código: pré = 2025-08 e 2025-09; pós = 2025-10 e 2025-11 — não acompanham o seletor de período da tela",
    ],
    notes: [
      "As janelas são fixas e compartilham o mesmo corte: 2×2 = ago–set/25 × out–nov/25; 4×4 = jun–set/25 × out/25–jan/26; 6×6 = abr–set/25 × out/25–mar/26. Mudar o período da tela não move esta comparação.",
      "trimestres_utilizantes cobre um recorte de tempo diferente (desde 2025-07, em diante) das janelas pré/pós.",
      "Metodologia idêntica à do fragmento legado: eixo é data de atendimento, sinistro é bruto.",
    ],
    related: ["claims.mature-comparison", "claims.sanus-journey"],
  },
  {
    id: "claims.mature-comparison",
    kind: "block",
    label: "Comparação madura: 4 meses antes × 4 meses depois",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "famílias e sinistro por tipo de evento nas janelas de 2×2, 4×4 e 6×6 meses, restrito a famílias presentes nos dois lados",
        columns: ["family_key", "month_key", "custo_assistencial_bruto", "tipo_evento", "flag_data_suspeita", "company_key"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Cada seletor forma uma coorte própria: family_key é o titular normalizado dentro da empresa e seus dependentes vinculados. A coorte inclui somente family_key não nulo presente nos dois lados; itens = COUNT(*), sinistro = SUM(custo_assistencial_bruto), pronto_socorro/internacao/consulta/terapia = COUNT(*) filtrado por tipo_evento; deltas_pct compara before × after.",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "janelas fixas: 2×2 = ago–set/25 × out–nov/25; 4×4 = jun–set/25 × out/25–jan/26; 6×6 = abr–set/25 × out/25–mar/26",
      "restrito às famílias com uso registrado nas DUAS janelas (INNER JOIN de family_key não nulo em cada seletor)",
    ],
    notes: [
      "Herdado do BI antigo: mede associação temporal entre duas janelas, não causalidade.",
      "Dependente sem ponte familiar na origem não recebe family_key e fica fora da coorte; nunca é contado como família separada.",
      "familias_comuns é o MÍNIMO entre before.familias e after.familias, não uma contagem de interseção própria: como a query já restringe a base às famílias presentes nas duas janelas, os dois números tendem a ser iguais — o mínimo é só uma salvaguarda defensiva, não um terceiro cálculo.",
    ],
    related: ["claims.sanus-impact"],
  },
  {
    id: "claims.sanus-journey",
    kind: "block",
    label: "Jornada Sanus: alcance digital e proximidade com o sinistro",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "coorte de famílias utilizantes na janela de 12 meses fechados",
        columns: ["family_key", "month_key", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.gold,
        role: "eventos de sinistro da coorte, com data de atendimento, para medir proximidade com contato digital",
        columns: ["row_sha256", "family_key", "data_atendimento", "month_key", "flag_data_suspeita", "company_key"],
      },
      {
        object: TABLES.factCoordenacao,
        role: "contatos digitais (Conexa e HealthCoach) por família, com data e identificador do evento",
        columns: ["family_key", "source_system", "event_type", "source_event_id", "event_date"],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "servicos: alcance por serviço = COUNT(DISTINCT familia) com qualquer contato do serviço na janela, sobre COUNT(*) da coorte; proximidade: para cada evento de sinistro, distância em dias até o contato digital anterior mais próximo, agrupada em faixas — mesmo_dia (dias = 0), ate_7d (dias ≤ 7), ate_15d (dias ≤ 15) e ate_40d (dias ≤ 40, a mesma população de utilizacoes_ate_40d); media_dias = AVG(dias) entre os eventos com contato encontrado; familias_com_proximidade = COUNT(DISTINCT familia) entre esses mesmos eventos; share_ate_40d = utilizacoes_ate_40d ÷ utilizacoes_cohort × 100.",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "janela de 12 meses fechados (mesma de claims.kpis)",
      "contato digital restrito a source_system = 'healthcoach_gold_live' ou event_type de Conexa (consulta eletiva ou PA digital)",
    ],
    notes: [
      "A ponte de coordenação é por family_key (empresa + CPF do titular, sem CPF exposto): contato digital do DEPENDENTE não casa com a família — cobertura parcial, igual à ressalva do bloco de coordenação da Visão 360 (care-timeline.matrix).",
      "Proximidade é associação temporal (até 40 dias), não atribuição causal: um atendimento próximo de um contato digital não prova que o contato causou o atendimento.",
      "fact_coordenacao_evento_gold_v2 é alimentada pelos pipelines DLT contínuos (atendimento_gold_live, healthcoach_gold_live) e se atualiza o tempo todo. Os demais blocos desta aba leem a Silver de sinistro, que só avança quando a ingestão manual roda — por isso os números deste bloco podem mudar entre dois carregamentos no mesmo dia, mesmo com o resto da aba parado.",
    ],
    related: ["claims.sanus-impact"],
  },
  {
    id: "claims.top-users",
    kind: "block",
    label: "Maiores utilizantes (Top 10, mascarado)",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "top 10 pessoas por custo na janela de 12 meses fechados, com demografia agregada",
        columns: [
          "person_key",
          "faixa_etaria_usuario",
          "parentesco_usuario",
          "nome_lotacao",
          "custo_assistencial_bruto",
          "flag_internacao",
          "episode_key",
          "month_key",
          "flag_data_suspeita",
          "company_key",
        ],
      },
      FONTE_FILTRO_CIDADE_ESTADO,
    ],
    formula:
      "Top 10 por SUM(custo_assistencial_bruto) na janela; internacoes = COUNT(DISTINCT episode_key) entre eventos com flag_internacao; share = custo da pessoa ÷ custo somado de TODAS as pessoas da janela (antes do corte para 10) × 100.",
    filters: [
      ESCOPO_USUARIO,
      NOT_SUSPEITA,
      FILTROS_OPCIONAIS,
      "janela de 12 meses fechados (mesma de claims.kpis)",
      "dado sensível — uso interno; identidade mascarada por chave opaca antes de sair do servidor",
    ],
    notes: [
      "id_corrompido é sempre false: campo herdado do payload v1 (reconstrução manual de código de usuário corrompido), mantido só por compatibilidade de forma com o consumidor legado — não é calculado a partir de nenhum dado nesta rota v2.",
      "codigo_usuario é maskPerson(person_key): os 8 primeiros caracteres da chave opaca, nunca o identificador bruto.",
    ],
    related: ["claims.concentration"],
  },
];
