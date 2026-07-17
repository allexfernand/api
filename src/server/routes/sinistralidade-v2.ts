// Adaptador HTTP da Sinistralidade v2. Período, permissões, consultas e
// serialização vivem em src/server/sinistralidade/.

import { sinistralidadeV2Handler, type ApiRequest, type ApiResponse } from "../sinistralidade";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  return sinistralidadeV2Handler(req, res);
}
