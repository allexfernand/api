import { readFileSync } from "node:fs";
import { join } from "node:path";

export type DashboardFragmentName =
  | "demographics"
  | "partner-vision"
  | "appointments"
  | "care-coordination"
  | "sessions"
  | "executive-committee"
  | "executive-committee-mds"
  | "claims-analysis"
  | "gold-preview"
  | "quality-strategic"
  | "quality-operational"
  | "footer";

export type DashboardFragments = Record<DashboardFragmentName, string>;

export const dashboardFragmentNames: DashboardFragmentName[] = [
  "demographics",
  "partner-vision",
  "appointments",
  "care-coordination",
  "sessions",
  "executive-committee",
  "executive-committee-mds",
  "claims-analysis",
  "gold-preview",
  "quality-strategic",
  "quality-operational",
  "footer",
];

export function readDashboardFragment(name: DashboardFragmentName) {
  return readFileSync(join(process.cwd(), "src", "dashboard", "fragments", `${name}.html`), "utf8");
}

export function readAllDashboardFragments(): DashboardFragments {
  return Object.fromEntries(
    dashboardFragmentNames.map((name) => [name, readDashboardFragment(name)]),
  ) as DashboardFragments;
}
