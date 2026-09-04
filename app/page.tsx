import Script from "next/script";
import { DashboardPage } from "../src/features/dashboard/components/DashboardPage";
import { readAllDashboardFragments } from "../src/dashboard/fragment";

export default function Page() {
  const fragments = readAllDashboardFragments();
  return (
    <>
      <DashboardPage fragments={fragments} />
      <Script src="/scripts/dashboard.js?v=20260904-q11c-qa" strategy="afterInteractive" />
    </>
  );
}
