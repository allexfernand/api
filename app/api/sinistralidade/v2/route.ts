import handler from "../../../../src/server/routes/sinistralidade-v2";
import { adaptLegacyRoute } from "../../../../src/server/http/route-adapter";

export const maxDuration = 60;
export const GET = adaptLegacyRoute(handler);
export const OPTIONS = GET;
