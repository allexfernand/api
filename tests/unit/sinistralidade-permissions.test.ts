import { afterEach, describe, expect, it } from "vitest";
import { sinistralidadeFeatureFlags } from "../../src/server/sinistralidade/feature-flags";
import {
  assertIndividualDetail,
  assertIndividualRanking,
  individualAccessForAuth,
} from "../../src/server/sinistralidade/permissions";

const FLAG_VARS = [
  "SINISTRALIDADE_360_LONGITUDINAL_ENABLED",
  "SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED",
  "SINISTRALIDADE_360_INDIVIDUAL_DETAIL_ENABLED",
  "SINISTRALIDADE_360_COMPANY_BENCHMARK_ENABLED",
  "SINISTRALIDADE_INDIVIDUAL_RANKING_USERS",
  "SINISTRALIDADE_INDIVIDUAL_DETAIL_USERS",
];

afterEach(() => {
  for (const name of FLAG_VARS) delete process.env[name];
});

describe("feature flags", () => {
  it("todas desligadas por padrão", () => {
    expect(sinistralidadeFeatureFlags()).toEqual({
      longitudinal: false,
      individualRanking: false,
      individualDetail: false,
      companyBenchmark: false,
    });
  });

  it("liga somente com valor literal true", () => {
    process.env.SINISTRALIDADE_360_LONGITUDINAL_ENABLED = "TRUE";
    process.env.SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED = "1";
    expect(sinistralidadeFeatureFlags().longitudinal).toBe(true);
    expect(sinistralidadeFeatureFlags().individualRanking).toBe(false);
  });
});

describe("permissões individuais (GOV-06)", () => {
  const admin = { user: "Analista", role: "full" as const };
  const mds = { user: "mds", role: "mds" as const };

  it("acesso administrativo genérico não é autorização individual implícita", () => {
    process.env.SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED = "true";
    process.env.SINISTRALIDADE_360_INDIVIDUAL_DETAIL_ENABLED = "true";
    // Flags ligadas, mas sem lista de usuários: nada é liberado.
    expect(individualAccessForAuth(admin)).toEqual({ ranking: false, detail: false });
    expect(() => assertIndividualRanking(admin)).toThrow("Ranking individual não autorizado");
    expect(() => assertIndividualDetail(admin)).toThrow("Detalhe individual não autorizado");
  });

  it("libera por usuário explícito, sem diferenciar caixa", () => {
    process.env.SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED = "true";
    process.env.SINISTRALIDADE_INDIVIDUAL_RANKING_USERS = "analista, outro";
    expect(individualAccessForAuth(admin).ranking).toBe(true);
    expect(individualAccessForAuth(admin).detail).toBe(false);
  });

  it("flag desligada bloqueia mesmo com usuário na lista", () => {
    process.env.SINISTRALIDADE_INDIVIDUAL_DETAIL_USERS = "analista";
    expect(individualAccessForAuth(admin).detail).toBe(false);
  });

  it("MDS nunca recebe acesso individual, mesmo com curinga", () => {
    process.env.SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED = "true";
    process.env.SINISTRALIDADE_360_INDIVIDUAL_DETAIL_ENABLED = "true";
    process.env.SINISTRALIDADE_INDIVIDUAL_RANKING_USERS = "*";
    process.env.SINISTRALIDADE_INDIVIDUAL_DETAIL_USERS = "*";
    expect(individualAccessForAuth(mds)).toEqual({ ranking: false, detail: false });
    expect(individualAccessForAuth(admin)).toEqual({ ranking: true, detail: true });
  });

  it("erros de permissão carregam statusCode 403", () => {
    try {
      assertIndividualDetail(admin);
      expect.unreachable();
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(403);
    }
  });
});
