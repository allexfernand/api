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
  it("todas ligadas por padrão", () => {
    expect(sinistralidadeFeatureFlags()).toEqual({
      longitudinal: true,
      individualRanking: true,
      individualDetail: true,
      companyBenchmark: true,
    });
  });

  it("desliga somente com valor literal false", () => {
    process.env.SINISTRALIDADE_360_LONGITUDINAL_ENABLED = "FALSE";
    process.env.SINISTRALIDADE_360_INDIVIDUAL_RANKING_ENABLED = "0";
    expect(sinistralidadeFeatureFlags().longitudinal).toBe(false);
    expect(sinistralidadeFeatureFlags().individualRanking).toBe(true);
  });
});

describe("permissões individuais (GOV-06)", () => {
  const admin = { user: "Analista", role: "full" as const };
  const mds = { user: "mds", role: "mds" as const };

  it("sem lista configurada, acesso individual é liberado por padrão", () => {
    expect(individualAccessForAuth(admin)).toEqual({ ranking: true, detail: true });
    expect(() => assertIndividualRanking(admin)).not.toThrow();
    expect(() => assertIndividualDetail(admin)).not.toThrow();
  });

  it("lista configurada restringe aos usuários citados, sem diferenciar caixa", () => {
    process.env.SINISTRALIDADE_INDIVIDUAL_RANKING_USERS = "analista, outro";
    process.env.SINISTRALIDADE_INDIVIDUAL_DETAIL_USERS = "somente-outro";
    expect(individualAccessForAuth(admin).ranking).toBe(true);
    expect(individualAccessForAuth(admin).detail).toBe(false);
  });

  it("flag desligada bloqueia mesmo com usuário na lista", () => {
    process.env.SINISTRALIDADE_360_INDIVIDUAL_DETAIL_ENABLED = "false";
    process.env.SINISTRALIDADE_INDIVIDUAL_DETAIL_USERS = "analista";
    expect(individualAccessForAuth(admin).detail).toBe(false);
  });

  it("MDS nunca recebe acesso individual, mesmo com curinga", () => {
    process.env.SINISTRALIDADE_INDIVIDUAL_RANKING_USERS = "*";
    process.env.SINISTRALIDADE_INDIVIDUAL_DETAIL_USERS = "*";
    expect(individualAccessForAuth(mds)).toEqual({ ranking: false, detail: false });
    expect(individualAccessForAuth(admin)).toEqual({ ranking: true, detail: true });
  });

  it("erros de permissão carregam statusCode 403", () => {
    process.env.SINISTRALIDADE_360_INDIVIDUAL_DETAIL_ENABLED = "false";
    try {
      assertIndividualDetail(admin);
      expect.unreachable();
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(403);
    }
  });
});
