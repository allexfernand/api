// Tipos do contrato 1.1.0 consumidos pela Sinistralidade 360.

export type { LineageEntry, LineageRegistry, LineageSource, LineageLayer } from "../../contracts/sinistralidade-v2";
export type { DashboardRole } from "../../contracts/common";

export type PeriodStatus = "closed" | "partial" | "unknown";
export type ScopeState = "valid" | "partial" | "blocked" | "not_comparable";

export type LongitudinalEnvelope = {
  contract_version: string;
  generated_at: string;
  company_key?: string;
  scope: string;
  state: ScopeState;
  requested_period: { end_month: string | null; window_months: number | null; include_partial: boolean };
  effective_period: { start_month: string | null; end_month: string | null; months: { month: string; status: PeriodStatus }[] };
  units: Record<string, string>;
  coverage: {
    person: number | null;
    episode: number | null;
    family: number | null;
    procedure: number | null;
    provider: number | null;
    cid: number | null;
    eligibility: "available" | "unavailable" | "partial";
  } | null;
  warnings: string[];
  quality_run_id: string | null;
  updated_at: string | null;
};

export type ScopeResponse<T> = { source: LongitudinalEnvelope; data: T };

export type Features = {
  longitudinal: boolean;
  individual_ranking: boolean;
  individual_detail: boolean;
  company_benchmark: boolean;
};

export type Company = {
  company_key: string;
  name: string;
  operator: string;
  first_observed_date: string | null;
  last_observed_date: string | null;
  observed_rows: number;
};

export type GrowthInfo = { state: "valid" | "new" | "not_comparable"; pct: number | null };

export type TimelineMonth = {
  month: string;
  status: PeriodStatus;
  has_data: boolean;
  included: boolean;
  gross_cost: number | null;
  utilizers: number | null;
  service_quantity: number | null;
  billing_lines: number | null;
  hospitalization_episodes: number | null;
  utilizing_families: number | null;
  cost_per_utilizer: number | null;
  eligible_lives: number | null;
  cost_per_eligible_life: number | null;
  mom: GrowthInfo;
  yoy: GrowthInfo;
  moving_average_cost: number | null;
};

export type TimelineKpis = {
  months_included: number;
  gross_cost: number;
  utilizers: number;
  service_quantity: number;
  hospitalization_episodes: number;
  utilizing_families: number;
  cost_per_utilizer: number | null;
  services_per_utilizer: number | null;
  cost_per_eligible_life: number | null;
  hospitalizations_per_thousand_lives: number | null;
  normalized_state: "valid" | "not_comparable";
};

export type CompetencyMonth = {
  month: string;
  gross_cost: number | null;
  service_quantity: number | null;
  billing_lines: number | null;
};

export type TimelineData = {
  months: TimelineMonth[];
  competency: CompetencyMonth[];
  kpis: TimelineKpis | null;
  updatedAt: string | null;
};

export type EventMixData = {
  months: {
    month: string;
    event_type: string;
    billing_lines: number;
    service_quantity: number;
    utilizers: number;
    hospitalization_episodes: number;
    gross_cost: number;
    month_cost_share: number;
  }[];
  window_totals: { event_type: string; gross_cost: number; service_quantity: number; window_cost_share: number | null }[];
};

export type TopUserRow = {
  entity_key: string;
  label: string;
  position: number;
  previous_position: number | null;
  position_delta: number | null;
  is_new_entrant: boolean;
  age_group: string | null;
  relationship: string | null;
  billing_lines: number;
  service_quantity: number;
  gross_cost: number;
  reimbursement_cost: number;
  reimbursement_share: number | null;
  average_cost_per_service: number | null;
  hospitalization_episodes: number;
  months_with_usage: number;
  recurrence: number | null;
  primary_event: string | null;
  cost_share: number | null;
  // Mês coberto sem consumo = 0; mês sem cobertura da empresa = null.
  monthly: { month: string; gross_cost: number | null; service_quantity: number | null; hospitalization_episodes: number | null }[];
};

export type TopUsersData = { rows: TopUserRow[]; window_total_cost: number };

export type UserDetailData = {
  entity_key: string;
  label: string;
  age_group: string | null;
  relationship: string | null;
  monthly: {
    month: string;
    has_data: boolean;
    covered: boolean;
    billing_lines: number | null;
    service_quantity: number | null;
    gross_cost: number | null;
    hospitalization_episodes: number | null;
    primary_event: string | null;
    rank_position: number | null;
  }[];
  events: { event_type: string; billing_lines: number; service_quantity: number; gross_cost: number }[];
  procedures: { procedure: string; macrogroup: string; service_quantity: number; gross_cost: number }[];
  providers: { provider: string; billing_lines: number; gross_cost: number }[];
  hospitalizations: { month: string; grouping: string; duration_days: number | null; gross_cost: number; mental_health: boolean }[];
};

export type ProcedureWindowRow = {
  entity_key: string;
  description: string;
  macrogroup: string;
  billing_lines: number;
  service_quantity: number;
  monthly_utilizers_sum: number;
  hospitalization_episodes: number;
  gross_cost: number;
  reimbursement_cost: number;
  reimbursement_share: number | null;
  average_cost_per_service: number | null;
  cost_share: number | null;
  cumulative_cost_share: number | null;
  position: number;
};

export type ProcedureTrendsData = {
  window: ProcedureWindowRow[];
  pareto: { entity_key: string; description: string; gross_cost: number; cost_share: number | null; cumulative_cost_share: number | null }[];
  series: { entity_key: string; description: string; monthly: { month: string; service_quantity: number | null; gross_cost: number | null }[] }[];
  growth_ranking: {
    entity_key: string;
    description: string;
    last_month_cost: number | null;
    previous_month_cost: number | null;
    growth_state: string;
    growth_pct: number | null;
  }[];
};

export type HospitalizationTrendsData = {
  monthly: {
    month: string;
    mental_health: boolean;
    episodes: number;
    utilizers: number;
    total_cost: number;
    average_episode_cost: number | null;
    median_duration_days: number | null;
    p90_duration_days: number | null;
    duration_coverage: number | null;
  }[];
  groups: {
    grouping: string;
    episodes: number;
    monthly_utilizers_sum: number;
    total_cost: number;
    average_episode_cost: number | null;
    median_duration_days: number | null;
  }[];
  providers: { entity_key: string; provider: string; episodes: number; monthly_utilizers_sum: number; gross_cost: number }[];
};

export type ProviderTrendsData = {
  window: {
    entity_key: string;
    provider: string;
    provider_type: string;
    specialty: string;
    billing_lines: number;
    service_quantity: number;
    monthly_utilizers_sum: number;
    hospitalization_episodes: number;
    gross_cost: number;
    average_ticket: number | null;
    reimbursement_cost: number;
    cost_share: number | null;
    cumulative_cost_share: number | null;
    position: number;
  }[];
  series: { entity_key: string; provider: string; monthly: { month: string; service_quantity: number | null; gross_cost: number | null }[] }[];
  network_split: { month: string; reimbursement: boolean; gross_cost: number; service_quantity: number }[];
};

export type ConcentrationData = {
  monthly: {
    month: string;
    utilizers: number;
    total_cost: number;
    top1_share: number | null;
    top5_share: number | null;
    top10_share: number | null;
    top10pct_share: number | null;
    people_to_50pct: number | null;
    people_to_80pct: number | null;
    top10_recurrent_from_previous_month: number;
  }[];
};

export type BenchmarkData = {
  companies: {
    company_key: string;
    name: string;
    gross_cost: number;
    operator_cost_share: number | null;
    monthly_utilizers_sum: number;
    service_quantity: number;
    billing_lines: number;
    months_observed: number;
    cost_per_utilizer: number | null;
    services_per_utilizer: number | null;
    cost_per_eligible_life: number | null;
    normalized_state: "valid" | "not_comparable";
  }[];
};

export type FamilyTimelineData = {
  relative_months: {
    relative_month: number;
    families: number;
    utilizing_people: number;
    billing_lines: number;
    service_quantity: number;
    hospitalization_episodes: number;
    gross_cost: number;
    primary_event: string;
    entry_date_source: string;
    cohorts: number;
  }[];
};

export type CareTimelineData = {
  demographics: {
    dimension: string;
    value: string;
    used_plan: boolean;
    had_care_coordination: boolean;
    people: number | null;
    gross_cost: number;
  }[];
  monthly: {
    month: string;
    used_plan: boolean;
    had_care_coordination: boolean;
    people: number | null;
    families: number | null;
    billing_lines: number;
    gross_cost: number;
    coordination_events: number;
    holders: number | null;
    dependents: number | null;
    people_without_family_bridge: number;
  }[];
};

export type PsTrendsData = {
  monthly: { month: string; service_quantity: number; gross_cost: number; ps_episodes: number | null }[];
  top_items: {
    entity_key: string;
    description: string;
    macrogroup: string;
    monthly_ps_episodes_sum: number;
    monthly_utilizers_sum: number;
    service_quantity: number;
    gross_cost: number;
    quantity_per_episode: number | null;
  }[];
};

export const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
export const moneyFull = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export const percent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function monthLabel(value: string) {
  if (!value) return "—";
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)))
    .replace(" de ", "/");
}

export function shortMonthLabel(value: string) {
  return value ? value.slice(5) + "/" + value.slice(2, 4) : "—";
}
