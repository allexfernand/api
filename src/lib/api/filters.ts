import type { DashboardFilters } from "../../contracts/common";

export function filtersToSearchParams(filters: DashboardFilters) {
  const params = new URLSearchParams();
  if (filters.groups.length === 1) params.set("group_name", filters.groups[0]);
  if (filters.groups.length > 1) params.set("group_names", JSON.stringify(filters.groups));
  if (filters.company) params.set("company", filters.company);
  if (filters.beneficiaryType) params.set("type", filters.beneficiaryType);
  if (filters.partnerBrokerId) params.set("partner_broker_id", filters.partnerBrokerId);
  if (filters.months.length) params.set("meses", filters.months.join(","));
  return params;
}
