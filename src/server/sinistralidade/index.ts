// Orquestração da API Sinistralidade v2 (contrato 1.1.0).
// A rota HTTP é apenas um adaptador; período, permissão, consulta e
// serialização vivem nos módulos deste diretório.

import { getDashboardAuth, requireBasicAuth } from "../../../lib/basic-auth";
import { setApiCors, setStableCache } from "../../../lib/http";
import {
  SINISTRALIDADE_CONTRACT_VERSION,
  longitudinalScopeSchema,
  sinistralidadeQuerySchema,
  type LongitudinalScope,
  type SinistralidadeQuery,
} from "../../contracts/sinistralidade-v2";
import { assertCompanyAccess, companyScopeSql } from "../auth/company-scope";
import { auditIndividualAccess } from "./audit";
import { sinistralidadeFeatureFlags } from "./feature-flags";
import { legacyScopeData } from "./legacy";
import { resolvePeriod, type ResolvedPeriod } from "./period-gate";
import {
  assertIndividualDetail,
  assertIndividualRanking,
  individualAccessForAuth,
  type AuthIdentity,
} from "./permissions";
import { createQueryRunner, TABLES, type QueryRunner } from "./query-runner";
import { buildEnvelope, fetchCoverage, fetchLatestQualityRunId, getCell, toInt } from "./serializers";
import { concentrationScope, companyBenchmarkScope, BENCHMARK_UNITS, CONCENTRATION_UNITS } from "./queries/concentration";
import { eventMixScope, EVENT_MIX_UNITS } from "./queries/event-mix";
import { familyTimelineScope, careTimelineScope, psTrendsScope, CARE_UNITS, FAMILY_UNITS, PS_UNITS } from "./queries/family-care";
import { hospitalizationTrendsScope, HOSPITALIZATION_UNITS } from "./queries/hospitalizations";
import { procedureTrendsScope, PROCEDURE_UNITS } from "./queries/procedures";
import { providerTrendsScope, PROVIDER_UNITS } from "./queries/providers";
import { topUsersWindowScope, userDetailScope, TOP_USERS_UNITS, USER_DETAIL_UNITS } from "./queries/rankings";
import { timelineScope, TIMELINE_UNITS } from "./queries/timeline";

export type ApiRequest = {
  method?: string;
  query: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
};
export type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

function first(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function queryRecord(query: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && String(first(value)) !== "")
      .map(([key, value]) => [key, String(first(value))]),
  ) as Record<string, string>;
}

function legacyMetadata(companyKey?: string, status: "closed" | "partial" | "unknown" = "unknown", warning: string | null = null) {
  return {
    contract_version: SINISTRALIDADE_CONTRACT_VERSION,
    generated_at: new Date().toISOString(),
    ...(companyKey ? { company_key: companyKey } : {}),
    period_status: status,
    warning,
  };
}

async function legacyMonthStatus(q: QueryRunner, companyKey: string, month?: string) {
  if (!month) return { status: "unknown" as const, warning: "Selecione um mês para validar o fechamento." };
  const rows = await q(
    `SELECT status FROM ${TABLES.monthStatus} WHERE company_key = '${companyKey}' AND month_key = '${month}' ORDER BY updated_at DESC LIMIT 1`,
  );
  const value = String(getCell(rows[0]?.[0] as never) || "unknown").toLowerCase();
  if (value === "closed") return { status: "closed" as const, warning: null };
  if (value === "partial") return { status: "partial" as const, warning: "Período parcial: não use para comparações fechadas." };
  return { status: "unknown" as const, warning: "O período ainda não possui gate de fechamento aprovado." };
}

function isLongitudinalScope(scope: SinistralidadeQuery["scope"]): scope is LongitudinalScope {
  return (longitudinalScopeSchema.options as readonly string[]).includes(scope);
}

async function handleLongitudinal(
  input: SinistralidadeQuery,
  auth: AuthIdentity,
  res: ApiResponse,
) {
  const scope = input.scope as LongitudinalScope;
  const flags = sinistralidadeFeatureFlags();
  if (!flags.longitudinal) {
    return res.status(403).json({
      error: "A visão longitudinal ainda não está habilitada neste ambiente (SINISTRALIDADE_360_LONGITUDINAL_ENABLED).",
    });
  }
  if (scope === "company-benchmark" && !flags.companyBenchmark) {
    return res.status(403).json({
      error: "A comparação entre empresas está bloqueada até a homologação de uma segunda empresa (SINISTRALIDADE_360_COMPANY_BENCHMARK_ENABLED).",
    });
  }
  if (scope === "top-users-window") assertIndividualRanking(auth);
  if (scope === "user-detail") assertIndividualDetail(auth);

  if (!input.end_month) {
    return res.status(400).json({ error: "end_month é obrigatório para os escopos longitudinais." });
  }
  const windowMonths = input.window_months ?? 12;
  const includePartial = input.include_partial === "true";
  const limit = input.limit ?? 10;
  const rankingBy = input.ranking_by ?? "cost";

  // Company scope: obrigatório no servidor e no SQL para todo escopo com
  // empresa. O benchmark usa o scope SQL do usuário, nunca o filtro do front.
  let companyKey: string | undefined;
  if (scope !== "company-benchmark") {
    if (!input.company_key) return res.status(400).json({ error: "company_key é obrigatório para este escopo." });
    companyKey = assertCompanyAccess(auth, input.company_key);
  }

  const q = await createQueryRunner(scope);
  const period = await resolvePeriod(q, companyKey ?? "*", input.end_month, windowMonths, includePartial);
  const qualityRunId = await fetchLatestQualityRunId(q);

  if (period.state === "blocked") {
    const envelope = buildEnvelope({
      scope,
      companyKey,
      period,
      units: {},
      coverage: null,
      qualityRunId,
    });
    return res.status(409).json({ source: envelope, data: null });
  }

  const coverage = companyKey ? await fetchCoverage(q, companyKey, period.usableMonths) : null;
  const suppressSmallGroups = auth.role === "mds";

  let data: unknown;
  let units: Record<string, string> = {};
  const warnings: string[] = [];
  let updatedAt: string | null = null;

  switch (scope) {
    case "timeline": {
      const result = await timelineScope(q, companyKey as string, period);
      data = result;
      units = TIMELINE_UNITS;
      updatedAt = result.updatedAt;
      break;
    }
    case "event-mix": {
      data = await eventMixScope(q, companyKey as string, period);
      units = EVENT_MIX_UNITS;
      break;
    }
    case "top-users-window": {
      data = await topUsersWindowScope(q, companyKey as string, period, { rankingBy, limit });
      units = TOP_USERS_UNITS;
      auditIndividualAccess({
        user: auth.user,
        role: auth.role,
        companyKey: companyKey as string,
        personKey: "ranking",
        scope,
        endMonth: input.end_month,
        windowMonths,
      });
      break;
    }
    case "user-detail": {
      if (!input.entity_key) return res.status(400).json({ error: "entity_key é obrigatório para o detalhe individual." });
      const detail = await userDetailScope(q, companyKey as string, period, input.entity_key.toLowerCase());
      if (!detail) {
        // Não distingue "pessoa de outra empresa" de "sem consumo": evita sondagem.
        return res.status(404).json({ error: "Beneficiário sem consumo na janela para esta empresa." });
      }
      auditIndividualAccess({
        user: auth.user,
        role: auth.role,
        companyKey: companyKey as string,
        personKey: input.entity_key,
        scope,
        endMonth: input.end_month,
        windowMonths,
      });
      data = detail;
      units = USER_DETAIL_UNITS;
      break;
    }
    case "procedure-trends": {
      data = await procedureTrendsScope(q, companyKey as string, period, { limit, eventType: input.event_type });
      units = PROCEDURE_UNITS;
      break;
    }
    case "hospitalization-trends": {
      data = await hospitalizationTrendsScope(q, companyKey as string, period, {
        mentalHealth: input.mental_health === undefined ? undefined : input.mental_health === "true",
      });
      units = HOSPITALIZATION_UNITS;
      break;
    }
    case "provider-trends": {
      data = await providerTrendsScope(q, companyKey as string, period, {
        limit,
        network: input.network,
        specialty: input.specialty,
      });
      units = PROVIDER_UNITS;
      break;
    }
    case "concentration": {
      data = await concentrationScope(q, companyKey as string, period);
      units = CONCENTRATION_UNITS;
      break;
    }
    case "company-benchmark": {
      data = await companyBenchmarkScope(q, auth, period);
      units = BENCHMARK_UNITS;
      warnings.push("Comparações normalizadas por vida só aparecem com denominador contemporâneo válido em todos os meses.");
      break;
    }
    case "family-timeline": {
      data = await familyTimelineScope(q, companyKey as string);
      units = FAMILY_UNITS;
      warnings.push("Entrada familiar derivada do snapshot atual; dependentes sem ponte familiar não estão associados.");
      break;
    }
    case "care-timeline": {
      data = await careTimelineScope(q, companyKey as string, period, { suppressSmallGroups });
      units = CARE_UNITS;
      break;
    }
    case "ps-trends": {
      data = await psTrendsScope(q, companyKey as string, period, { limit });
      units = PS_UNITS;
      break;
    }
  }

  const envelope = buildEnvelope({
    scope,
    companyKey,
    period,
    units,
    coverage,
    warnings,
    qualityRunId,
    updatedAt,
  });

  if (scope === "user-detail") {
    // Detalhe individual: nunca cacheável.
    res.setHeader("Cache-Control", "no-store");
  } else {
    setStableCache(res);
  }
  return res.status(200).json({ source: envelope, data });
}

export async function sinistralidadeV2Handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  const auth = getDashboardAuth(req);
  if (!auth) return;

  const parsed = sinistralidadeQuerySchema.safeParse(queryRecord(req.query));
  if (!parsed.success) return res.status(400).json({ error: "Parâmetros inválidos.", details: parsed.error.flatten() });
  const input = parsed.data;

  try {
    if (input.scope === "metadata") {
      const q = await createQueryRunner("metadata");
      const rows = await q(
        `SELECT company_key, operadora, codigo_empresa, nome_empresa_canonico, primeira_data_observada, ultima_data_observada, linhas_observadas FROM ${TABLES.dimCompany} WHERE 1 = 1${companyScopeSql(auth)} ORDER BY nome_empresa_canonico`,
      );
      const flags = sinistralidadeFeatureFlags();
      const access = individualAccessForAuth(auth);
      setStableCache(res);
      return res.status(200).json({
        source: legacyMetadata(),
        features: {
          longitudinal: flags.longitudinal,
          individual_ranking: access.ranking,
          individual_detail: access.detail,
          company_benchmark: flags.companyBenchmark,
        },
        companies: rows.map((row) => ({
          company_key: String(getCell(row[0] as never)),
          operator: String(getCell(row[1] as never) || "—"),
          source_company_id: String(getCell(row[2] as never) || ""),
          name: String(getCell(row[3] as never) || "Empresa sem nome"),
          first_observed_date: getCell(row[4] as never),
          last_observed_date: getCell(row[5] as never),
          observed_rows: toInt(row[6] as never),
        })),
      });
    }

    if (isLongitudinalScope(input.scope)) {
      return await handleLongitudinal(input, auth, res);
    }

    // Escopos legados 1.0.0 — comportamento preservado.
    if (!input.company_key) return res.status(400).json({ error: "company_key é obrigatório para este escopo." });
    const companyKey = assertCompanyAccess(auth, input.company_key);
    const q = await createQueryRunner(input.scope);
    const period = await legacyMonthStatus(q, companyKey, input.month);
    if (
      period.status !== "closed" &&
      input.include_partial !== "true" &&
      ["overview", "top10", "mental-health", "ps-package", "care-coordination"].includes(input.scope)
    ) {
      return res.status(409).json({ error: period.warning, source: legacyMetadata(companyKey, period.status, period.warning) });
    }

    const data = await legacyScopeData(q, input, companyKey);
    setStableCache(res);
    return res.status(200).json({ source: legacyMetadata(companyKey, period.status, period.warning), data });
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode) || 500;
    return res.status(status).json({ error: error instanceof Error ? error.message : "Falha ao consultar sinistralidade v2." });
  }
}

export type { ResolvedPeriod };
