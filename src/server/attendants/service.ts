import {
  ATTENDANT_DEPARTMENTS,
  DEFAULT_ATTENDANT_DEPARTMENT,
  DEFAULT_ATTENDANT_STATUS,
  type AttendantCandidate,
  type AttendantDepartment,
  type AttendantMapping,
  type AttendantStatus,
  type UpsertAttendantMappingRequest,
} from "../../contracts/attendants";
import { createSqlParams, getCell, quoteIdent, resolveWarehouseId, runQuery, toInt } from "../../../lib/databricks";
import { readAttendantMappings, writeAttendantMappings } from "../config/attendant-store";

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;

export function normalizeAttendantKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/@sanus\.tech$/i, "");
}

export function attendantDisplayName(value: string) {
  const withoutDomain = String(value || "")
    .replace(/@sanus\.tech$/i, "")
    .replace(/[_-]+/g, ".")
    .trim();
  const parts = withoutDomain.split(/[.\s]+/).filter(Boolean);
  if (!parts.length) return String(value || "Não informado");
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
}

function attendantNameAliases(value: string) {
  const name = String(value || "").trim();
  if (!name) return [];
  const withoutDomain = name.replace(/@sanus\.tech$/i, "");
  return [...new Set([name, withoutDomain, `${withoutDomain}@sanus.tech`].filter(Boolean))];
}

export type ResolvedAttendantMeta = {
  name: string;
  display_name: string;
  department: AttendantDepartment;
  status: AttendantStatus;
  aliases: string[];
  mapped: boolean;
};

export function resolveAttendantMeta(
  rawName: string,
  mappings: AttendantMapping[],
): ResolvedAttendantMeta {
  const raw = String(rawName || "").trim();
  const byAlias = new Map<string, AttendantMapping>();
  for (const item of mappings) {
    const names = [item.name, item.displayName, ...(item.aliases || [])].filter(Boolean) as string[];
    for (const alias of names) byAlias.set(normalizeAttendantKey(alias), item);
  }

  const rawKey = normalizeAttendantKey(raw);
  let direct =
    byAlias.get(rawKey) ||
    mappings.find((item) => {
      const itemKey = normalizeAttendantKey(item.name);
      return itemKey && !itemKey.includes(".") && rawKey.startsWith(`${itemKey}.`);
    });

  const canonicalName = direct?.name || raw;
  const aliases = new Set<string>();
  attendantNameAliases(canonicalName).forEach((alias) => aliases.add(alias));
  if (direct) {
    [direct.name, direct.displayName, ...(direct.aliases || [])]
      .filter(Boolean)
      .forEach((alias) => attendantNameAliases(String(alias)).forEach((v) => aliases.add(v)));
  }
  if (raw) attendantNameAliases(raw).forEach((alias) => aliases.add(alias));

  return {
    name: canonicalName || raw || "Não informado",
    display_name: direct?.displayName || attendantDisplayName(canonicalName || raw || "Não informado"),
    department: direct?.department || DEFAULT_ATTENDANT_DEPARTMENT,
    status: direct?.status || DEFAULT_ATTENDANT_STATUS,
    aliases: [...aliases],
    mapped: Boolean(direct),
  };
}

export async function listAttendantMappings() {
  return readAttendantMappings();
}

export async function upsertAttendantMapping(input: UpsertAttendantMappingRequest) {
  const current = await readAttendantMappings();
  const key = normalizeAttendantKey(input.name);
  const nextItem: AttendantMapping = {
    name: input.name.trim(),
    displayName: input.displayName?.trim() || undefined,
    department: input.department,
    status: input.status,
    aliases: [...new Set((input.aliases || []).map((alias) => alias.trim()).filter(Boolean))],
    updatedAt: new Date().toISOString(),
  };
  const next = current.filter((item) => normalizeAttendantKey(item.name) !== key);
  next.push(nextItem);
  next.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  await writeAttendantMappings(next);
  return nextItem;
}

export async function deleteAttendantMapping(name: string) {
  const key = normalizeAttendantKey(name);
  const current = await readAttendantMappings();
  const next = current.filter((item) => normalizeAttendantKey(item.name) !== key);
  if (next.length === current.length) {
    throw new Error("Atendente não encontrado no mapa.");
  }
  await writeAttendantMappings(next);
  return name.trim();
}

/** Lista finished_by distintos em botmaker_session (fonte A), só nos últimos N meses. */
export async function listFinishedByCandidates(monthsBack = 12): Promise<AttendantCandidate[]> {
  const warehouseId = await resolveWarehouseId();
  const params = createSqlParams();
  const windowMonths = Math.max(1, Math.min(36, Number(monthsBack) || 12));
  const rows = await runQuery(
    warehouseId,
    `
      SELECT
        NULLIF(TRIM(CAST(${quoteIdent("finished_by")} AS STRING)), '') AS attendant_name,
        COUNT(*) AS sessions,
        MAX(DATE_FORMAT(try_cast(${quoteIdent("creation_time")} AS TIMESTAMP), 'yyyy-MM-dd')) AS last_seen
      FROM ${SESSION_TABLE}
      WHERE ${quoteIdent("finished_by")} IS NOT NULL
        AND TRIM(CAST(${quoteIdent("finished_by")} AS STRING)) != ''
        AND try_cast(${quoteIdent("creation_time")} AS TIMESTAMP) >= add_months(current_timestamp(), -${windowMonths})
      GROUP BY 1
      ORDER BY sessions DESC
      LIMIT 1000
    `,
    params.list,
  );

  return rows
    .map((row) => ({
      name: String(getCell(row[0]) || "").trim(),
      sessions: toInt(row[1]),
      lastSeen: getCell(row[2]) ? String(getCell(row[2])) : null,
    }))
    .filter((item) => item.name);
}

export function mergeCandidatesWithMappings(
  candidates: AttendantCandidate[],
  mappings: AttendantMapping[],
): AttendantCandidate[] {
  const byKey = new Map<string, AttendantCandidate>();
  for (const candidate of candidates) {
    byKey.set(normalizeAttendantKey(candidate.name), candidate);
  }
  for (const mapping of mappings) {
    const key = normalizeAttendantKey(mapping.name);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      name: mapping.name,
      sessions: 0,
      lastSeen: null,
    });
  }
  return [...byKey.values()].sort((a, b) => {
    if (b.sessions !== a.sessions) return b.sessions - a.sessions;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
}

export function groupSessionsByDepartment(
  rows: Array<{ attendant: string; total: number }>,
  mappings: AttendantMapping[],
) {
  const grouped = new Map<
    AttendantDepartment,
    { department: AttendantDepartment; total: number; attendants: number; active: number; inactive: number }
  >();
  for (const department of ATTENDANT_DEPARTMENTS) {
    grouped.set(department, {
      department,
      total: 0,
      attendants: 0,
      active: 0,
      inactive: 0,
    });
  }

  const seenAttendants = new Set<string>();
  for (const row of rows) {
    const meta = resolveAttendantMeta(row.attendant, mappings);
    const bucket = grouped.get(meta.department)!;
    bucket.total += Number(row.total) || 0;
    const key = normalizeAttendantKey(meta.name);
    if (!seenAttendants.has(key)) {
      seenAttendants.add(key);
      bucket.attendants += 1;
      if (meta.status === "Inativo") bucket.inactive += 1;
      else bucket.active += 1;
    }
  }

  const departments = ATTENDANT_DEPARTMENTS.map((department) => grouped.get(department)!);
  const total = departments.reduce((sum, item) => sum + item.total, 0);
  return {
    departments: departments.map((item) => ({
      ...item,
      pct: total > 0 ? Number(((item.total / total) * 100).toFixed(1)) : 0,
    })),
    total,
  };
}

export { ATTENDANT_DEPARTMENTS };
