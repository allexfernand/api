// Linhagem dos KPIs executivos da janela (ExecutiveKpis.tsx).
// Todos são agregados calculados em JavaScript sobre o resultado do escopo
// `timeline`; nenhum deles tem consulta própria. As tabelas de origem são as
// mesmas que o bloco timeline.monthly consulta, mas cada entrada declara
// apenas as colunas que o seu próprio cálculo lê — quem responde "esta coluna
// alimenta este número?" é a lista da entrada, não a do bloco mensal.
// A fórmula, por sua vez, é a do agregado de janela, não a da série mensal.

import type { LineageEntry } from "../../../contracts/sinistralidade-v2";
import { TABLES } from "../query-runner";

const FILTROS = [
  "company_key do escopo do usuário, aplicado no SQL",
  "somente meses aprovados pelo gate e com dado observado",
];

const NOTA_JANELA =
  "Soma apenas os meses incluídos na janela. Mês sem cobertura não entra no numerador nem no denominador.";

const NOTA_DENOMINADOR =
  "Só tem valor quando TODOS os meses incluídos têm snapshot de elegibilidade contemporâneo. Caso contrário o estado é not_comparable e o KPI exibe 'Denominador indisponível' — nunca um número aproximado.";

export const KPI_LINEAGE: LineageEntry[] = [
  {
    id: "kpi.gross_cost",
    kind: "metric",
    label: "Custo assistencial (janela)",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato mensal somado na janela",
        columns: ["month_key", "custo_assistencial_bruto"],
      },
    ],
    formula: "SUM(custo_assistencial_bruto) dos meses incluídos.",
    filters: FILTROS,
    notes: [NOTA_JANELA, "É custo bruto: não desconta coparticipação."],
    related: ["timeline.monthly"],
  },
  {
    id: "kpi.utilizers",
    kind: "metric",
    label: "Beneficiários utilizantes",
    layer: "mart",
    sources: [
      {
        object: TABLES.martPessoaMes,
        role: "identidade distinta na janela",
        columns: ["company_key", "month_key", "person_key"],
      },
    ],
    formula: "COUNT(DISTINCT person_key) sobre todos os meses incluídos, de uma vez.",
    filters: FILTROS,
    notes: [
      "Não é a soma dos utilizantes mensais. A mesma pessoa em três meses conta uma vez aqui e três vezes na soma mensal.",
      "Quem não usou o plano não está na base: este não é o total de vidas.",
    ],
    related: ["kpi.cost_per_utilizer", "top-users-window.table"],
  },
  {
    id: "kpi.service_quantity",
    kind: "metric",
    label: "Serviços realizados",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato mensal somado na janela",
        columns: ["month_key", "quantidade_servicos"],
      },
    ],
    formula: "SUM(quantidade_servicos) dos meses incluídos.",
    filters: FILTROS,
    notes: [NOTA_JANELA],
    related: ["kpi.services_per_utilizer"],
  },
  {
    id: "kpi.hospitalization_episodes",
    kind: "metric",
    label: "Episódios de internação",
    layer: "mart",
    sources: [
      {
        object: TABLES.martInternacaoMes,
        role: "episódios de internação",
        columns: ["month_key", "episodios_internacao"],
      },
    ],
    formula: "SUM(episodios_internacao) dos meses incluídos.",
    filters: FILTROS,
    notes: [
      "Conta ADMISSÕES, não diárias. O episódio é atribuído ao mês em que começou.",
    ],
    related: ["hospitalization-trends.monthly"],
  },
  {
    id: "kpi.utilizing_families",
    kind: "metric",
    label: "Famílias utilizantes",
    layer: "mart",
    sources: [
      {
        object: TABLES.martPessoaMes,
        role: "identidade distinta na janela",
        columns: ["company_key", "month_key", "family_key"],
      },
    ],
    formula: "COUNT(DISTINCT family_key) sobre todos os meses incluídos, de uma vez.",
    filters: FILTROS,
    notes: [
      "family_key é o titular normalizado dentro da empresa.",
      "Dependente sem ponte com o titular não é associado à família na origem.",
    ],
    related: ["family-timeline.relative"],
  },
  {
    id: "kpi.cost_per_utilizer",
    kind: "metric",
    label: "Custo por utilizante",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato mensal somado na janela",
        columns: ["month_key", "custo_assistencial_bruto"],
      },
      {
        object: TABLES.martPessoaMes,
        role: "identidade distinta na janela",
        columns: ["company_key", "month_key", "person_key"],
      },
    ],
    formula: "SUM(custo_assistencial_bruto) ÷ COUNT(DISTINCT person_key) na janela.",
    filters: FILTROS,
    notes: [
      "Normaliza pelo número de pessoas que USARAM. Não é per capita: quem não usou não está no denominador.",
      "Alta pode significar severidade ou mix pior; queda, mix mais leve.",
    ],
    related: ["kpi.utilizers", "kpi.cost_per_eligible_life"],
  },
  {
    id: "kpi.services_per_utilizer",
    kind: "metric",
    label: "Serviços por utilizante",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato mensal somado na janela",
        columns: ["month_key", "quantidade_servicos"],
      },
      {
        object: TABLES.martPessoaMes,
        role: "identidade distinta na janela",
        columns: ["company_key", "month_key", "person_key"],
      },
    ],
    formula: "SUM(quantidade_servicos) ÷ COUNT(DISTINCT person_key) na janela.",
    filters: FILTROS,
    notes: ["Mede intensidade de uso por pessoa que usou."],
    related: ["kpi.service_quantity"],
  },
  {
    id: "kpi.cost_per_eligible_life",
    kind: "metric",
    label: "Custo por vida elegível",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato mensal somado na janela",
        columns: ["month_key", "custo_assistencial_bruto", "vidas_elegiveis"],
      },
    ],
    formula: "SUM(custo_assistencial_bruto) ÷ SUM(vidas_elegiveis) dos meses incluídos.",
    filters: FILTROS,
    notes: [
      NOTA_DENOMINADOR,
      "Este é o per capita de verdade, ao contrário do custo por utilizante.",
      "O primeiro snapshot de elegibilidade é de 2026-07-16; meses anteriores não têm denominador e não podem ser reconstruídos retroativamente.",
    ],
    related: ["kpi.cost_per_utilizer", "timeline.monthly"],
  },
  {
    id: "kpi.hospitalizations_per_thousand_lives",
    kind: "metric",
    label: "Internações por mil vidas",
    layer: "mart",
    sources: [
      {
        object: TABLES.martInternacaoMes,
        role: "episódios de internação",
        columns: ["month_key", "episodios_internacao"],
      },
      {
        object: TABLES.martMonth,
        role: "fato mensal somado na janela",
        columns: ["month_key", "vidas_elegiveis"],
      },
    ],
    formula: "SUM(episodios_internacao) ÷ SUM(vidas_elegiveis) × 1.000 nos meses incluídos.",
    filters: FILTROS,
    notes: [NOTA_DENOMINADOR, "Indicador de severidade populacional."],
    related: ["kpi.hospitalization_episodes", "kpi.cost_per_eligible_life"],
  },
];
