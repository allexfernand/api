// NOTE: marker "server-only" removido — Pages Router (pages/api/*) não suporta o import e derruba todos os endpoints com 500.
import { timingSafeEqual } from "node:crypto";
import type { DashboardRole } from "../../contracts/common";

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function validateDashboardCredentials(
  user: string,
  password: string,
): { user: string; role: DashboardRole } | null {
  const fullUser = process.env.DASHBOARD_AUTH_USER || "";
  const fullPassword = process.env.DASHBOARD_AUTH_PASSWORD || "";
  const mdsUser = process.env.DASHBOARD_MDS_AUTH_USER || "";
  const mdsPassword = process.env.DASHBOARD_MDS_AUTH_PASSWORD || "";

  if (mdsUser && mdsPassword && safeEqual(user, mdsUser) && safeEqual(password, mdsPassword)) {
    return { user, role: "mds" };
  }
  if (fullUser && fullPassword && safeEqual(user, fullUser) && safeEqual(password, fullPassword)) {
    return { user, role: user.toLowerCase() === "mds" ? "mds" : "full" };
  }
  return null;
}
