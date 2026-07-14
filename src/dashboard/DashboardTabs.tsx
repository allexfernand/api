import type { DashboardFragments } from "./fragment";
import { DemographicsTab } from "../features/demographics/DemographicsTab";
import { AppointmentsTab } from "../features/appointments/AppointmentsTab";
import { CareCoordinationTab } from "../features/care-coordination/CareCoordinationTab";
import { SessionsTab } from "../features/sessions/SessionsTab";
import { ExecutiveCommitteeTab } from "../features/executive-committee/ExecutiveCommitteeTab";
import { ClaimsAnalysisTab } from "../features/claims/ClaimsAnalysisTab";
import { GoldPreviewTab } from "../features/claims/GoldPreviewTab";
import { StrategicQualityTab } from "../features/quality/StrategicQualityTab";
import { OperationalQualityTab } from "../features/quality/OperationalQualityTab";

export function DashboardTabs({ fragments }: { fragments: DashboardFragments }) {
  return (
    <main className="container">
      <DemographicsTab html={fragments.demographics} />
      <AppointmentsTab html={fragments.appointments} />
      <CareCoordinationTab html={fragments["care-coordination"]} />
      <SessionsTab html={fragments.sessions} />
      <ExecutiveCommitteeTab html={fragments["executive-committee"]} />
      <ExecutiveCommitteeTab html={fragments["executive-committee-mds"]} />
      <ClaimsAnalysisTab html={fragments["claims-analysis"]} />
      <GoldPreviewTab html={fragments["gold-preview"]} />
      <StrategicQualityTab html={fragments["quality-strategic"]} />
      <OperationalQualityTab html={fragments["quality-operational"]} />
    </main>
  );
}
