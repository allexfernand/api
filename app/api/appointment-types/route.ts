import handler from "../../../src/server/routes/appointment-types";
import { adaptLegacyRoute } from "../../../src/server/http/route-adapter";
export const maxDuration = 60;
export const GET = adaptLegacyRoute(handler);
export const OPTIONS = GET;
