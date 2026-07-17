// Flags de rollout da evolução longitudinal da Sinistralidade 360.
// Padrão: desligado. A ativação é gradual, por ambiente.

declare const process: { env: Record<string, string | undefined> };

function flag(name: string) {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

export type SinistralidadeFeatureFlags = {
  longitudinal: boolean;
  individualRanking: boolean;
  individualDetail: boolean;
  companyBenchmark: boolean;
};

export function sinistralidadeFeatureFlags(): SinistralidadeFeatureFlags {
  return {
    longitudinal: flag("SINISTRALIDADE_360_LONGITUDINAL_ENABLED"),
    individualRanking: flag("SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED"),
    individualDetail: flag("SINISTRALIDADE_360_INDIVIDUAL_DETAIL_ENABLED"),
    companyBenchmark: flag("SINISTRALIDADE_360_COMPANY_BENCHMARK_ENABLED"),
  };
}
