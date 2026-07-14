export type QueryValue = string | string[] | undefined;
export type QueryRecord = Record<string, QueryValue>;

export function parseGroupNames(query: QueryRecord) {
  const raw = query.group_names;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed))
        return [...new Set(parsed.map((value) => String(value).trim()).filter(Boolean))];
    } catch {
      return [];
    }
  }
  return query.group_name ? [String(query.group_name).trim()].filter(Boolean) : [];
}

export function pickColumn(columns: string[], candidates: string[]) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  return candidates.map((candidate) => byLower.get(candidate.toLowerCase())).find(Boolean) || null;
}

export function parseMonthList(value: QueryValue, max = 24) {
  const months = String(value || "")
    .split(",")
    .filter((month) => /^\d{4}-\d{2}$/.test(month));
  return [...new Set(months)].sort().slice(0, max);
}

export function nextMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const tables = {
  organizations: "hive_metastore.sanus_prod.organizations",
  partnerBrokers: "hive_metastore.sanus_prod.partner_brokers",
  organizationPartnerBrokers: "hive_metastore.sanus_prod.organization_partner_brokers",
} as const;
