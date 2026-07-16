import Script from "next/script";
import { DashboardPage } from "../src/features/dashboard/components/DashboardPage";
import { readAllDashboardFragments } from "../src/dashboard/fragment";

export default function Page() {
  const fragments = readAllDashboardFragments();
  return (
    <>
      <DashboardPage fragments={fragments} />
      <Script src="/scripts/dashboard.js?v=20260714-architecture2" strategy="afterInteractive" />
      <Script src="/scripts/gold-preview.js?v=20260715-help1" strategy="afterInteractive" />
    </>
  );
}
