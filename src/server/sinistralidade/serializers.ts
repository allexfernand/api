// Serialização da Sinistralidade 360.
// Campos sensíveis são removidos AQUI, antes do payload — nunca apenas no
// componente. Estados inválidos são explícitos: o frontend não deduz validade
// por null.

import { getCell, toInt, toNum } from "../databricks/client";
import {
  SINISTRALIDADE_CONTRACT_VERSION,
  type LongitudinalEnvelope,
  type LongitudinalScope,
  type ScopeState,
  type WindowMonths,
} from "../../contracts/sinistralidade-v2";
import type { ResolvedPeriod } from "./period-gate";
import { TABLES, type QueryRunner } from "./query-runner";

export { getCell, toInt, toNum };

export function toNullableNum(value: unknown) {
  const cell = getCell(value as never);
  if (cell === null || cell === undefined || cell === "") return null;
  const parsed = Number(cell);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toBool(value: unknown) {
  const normalized = String(getCell(value as never) ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function maskedBeneficiaryLabel(personKey: string) {
  return `Beneficiário ${personKey.slice(0, 8)}`;
}

/** Supressão de pequenos grupos (GOV-08) para perfis externos: contagens 0 < n < 5 viram null. */
export function suppressSmallGroup(count: number | null, suppress: boolean) {
  if (!suppress || count === null) return count;
  return count > 0 && count < 5 ? null : count;
}

export type ComparisonState = "valid" | "new" | "not_comparable";

/** Crescimento nunca é calculado sobre base zero/ausente (regra 7.3). */
export function growth(current: number | null, previous: number | null): { state: ComparisonState; pct: number | null } {
  if (current === null) return { state: "not_comparable", pct: null };
  if (previous === null) return { state: "not_comparable", pct: null };
  if (previous === 0) return { state: current === 0 ? "not_comparable" : "new", pct: null };
  return { state: "valid", pct: ((current - previous) / Math.abs(previous)) * 100 };
}

export function movingAverage(values: (number | null)[], window = 3): (number | null)[] {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1);
    const present = slice.filter((value): value is number => value !== null);
    if (present.length < window) return null;
    return present.reduce((total, value) => total + value, 0) / present.length;
  });
}

export type Coverage = LongitudinalEnvelope["coverage"];

export async function fetchCoverage(
  q: QueryRunner,
  companyKey: string,
  months: string[],
): Promise<Coverage> {
  if (!months.length) return null;
  const rows = await q(
    `SELECT
      round(avg(CASE WHEN person_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4),
      round(avg(CASE WHEN episode_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4),
      round(avg(CASE WHEN family_key IS NOT NULL THEN 1.0 ELSE 0.0 END), 4),
      round(avg(CASE WHEN nullif(trim(codigo_procedimento_operadora), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4),
      round(avg(CASE WHEN nullif(trim(prestador), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4),
      round(avg(CASE WHEN nullif(trim(codigo_cid_normalizado), '') IS NOT NULL THEN 1.0 ELSE 0.0 END), 4)
    FROM ${TABLES.gold}
    WHERE NOT flag_data_suspeita AND company_key = '${companyKey}'
      AND month_key IN (${months.map((month) => `'${month}'`).join(",")})`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    person: toNullableNum(row[0]),
    episode: toNullableNum(row[1]),
    family: toNullableNum(row[2]),
    procedure: toNullableNum(row[3]),
    provider: toNullableNum(row[4]),
    cid: toNullableNum(row[5]),
    eligibility: "unavailable",
  };
}

let qualityRunCache: { id: string | null; fetchedAt: number } | null = null;

export async function fetchLatestQualityRunId(q: QueryRunner): Promise<string | null> {
  if (qualityRunCache && Date.now() - qualityRunCache.fetchedAt < 5 * 60_000) return qualityRunCache.id;
  try {
    const rows = await q(`SELECT quality_run_id FROM ${TABLES.qualityRun} ORDER BY checked_at DESC LIMIT 1`);
    const id = rows[0] ? String(getCell(rows[0][0]) || "") || null : null;
    qualityRunCache = { id, fetchedAt: Date.now() };
    return id;
  } catch {
    return qualityRunCache?.id ?? null;
  }
}

export function buildEnvelope(input: {
  scope: LongitudinalScope;
  companyKey?: string;
  period: ResolvedPeriod;
  state?: ScopeState;
  units: Record<string, string>;
  coverage: Coverage;
  warnings?: string[];
  qualityRunId: string | null;
  updatedAt?: string | null;
}): LongitudinalEnvelope {
  return {
    contract_version: SINISTRALIDADE_CONTRACT_VERSION,
    generated_at: new Date().toISOString(),
    ...(input.companyKey ? { company_key: input.companyKey } : {}),
    scope: input.scope,
    state: input.state ?? input.period.state,
    requested_period: {
      end_month: input.period.requested.endMonth,
      window_months: (input.period.requested.windowMonths ?? null) as WindowMonths | null,
      include_partial: input.period.requested.includePartial,
    },
    effective_period: {
      start_month: input.period.effective.startMonth,
      end_month: input.period.effective.endMonth,
      months: input.period.effective.months,
    },
    units: input.units,
    coverage: input.coverage,
    warnings: [...input.period.warnings, ...(input.warnings ?? [])],
    quality_run_id: input.qualityRunId,
    updated_at: input.updatedAt ?? null,
  };
}
