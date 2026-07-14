import { DashboardFragment } from "../../../dashboard/DashboardFragment";
import { DashboardTabs } from "../../../dashboard/DashboardTabs";
import type { DashboardFragments } from "../../../dashboard/fragment";
import { DashboardShell } from "./DashboardShell";

export function DashboardPage({ fragments }: { fragments: DashboardFragments }) {
  return (
    <>
      <div className="dashboard-shell" style={{ display: "contents" }}>
        <DashboardShell />
      </div>
      <DashboardTabs fragments={fragments} />
      <DashboardFragment html={fragments.footer} />
    </>
  );
}
