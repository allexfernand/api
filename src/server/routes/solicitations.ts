// api/solicitations.ts
import { rejectMdsAuth, requireBasicAuth, scopedGroupNames } from "../../../lib/basic-auth";
import { getCell, resolveWarehouseId, runQuery, toFloat, toInt } from "../../../lib/databricks";
import { setApiCors, setStableCache } from "../../../lib/http";

type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};
function parseGroupNames(query: Record<string, any>) {
  const raw = query.group_names;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return [...new Set(parsed.map((v) => String(v).trim()).filter(Boolean))];
    } catch {}
  }
  return query.group_name ? [String(query.group_name).trim()].filter(Boolean) : [];
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (rejectMdsAuth(req, res)) return;

  const meses     = req.query.meses ? req.query.meses.split(',').filter((m: string) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));

  const periodoFilter = meses.length > 0
    ? `AND DATE_FORMAT(hora_criacao_atendimento, 'yyyy-MM') IN (${meses.map((m: string) => `'${m}'`).join(',')})`
    : '';

  const groupFilter = groupNames.length
    ? `AND (${groupNames.map((groupName) => `grupo_economico LIKE '%${groupName.replace(/'/g, "''")}'`).join(' OR ')})`
    : '';

  try {
    const warehouseId = await resolveWarehouseId();

    const rows = await runQuery(warehouseId, `
      SELECT
        CASE
          WHEN tipo_solicitacao IS NULL THEN 'Nulo'
          WHEN tipo_solicitacao IN ('Consulta', 'Médico') THEN 'Consulta'
          WHEN tipo_solicitacao IN ('Exame', 'Exames') THEN 'Exame'
          WHEN tipo_solicitacao IN ('Fisioterapia', 'Fonoterapia', 'Terapia Ocupacional') THEN 'Terapia'
          ELSE 'Outros'
        END AS tipo_agrupado,
        COUNT(*) AS quantidade
      FROM hive_metastore.sanus_prod.atendimento_gold_live
      WHERE motivo IN ('Concluído com sucesso', 'Concluído com sucesso pela DASA')
        ${periodoFilter}
        ${groupFilter}
      GROUP BY tipo_agrupado
      ORDER BY quantidade DESC
    `);

    const total = rows.reduce((acc, r) => acc + toInt(r[1]), 0);
    const items = rows.map(r => ({
      tipo: String(getCell(r[0]) || 'Outros'),
      quantidade: toInt(r[1]),
      percentual: total > 0 ? Math.round((toInt(r[1]) / total) * 1000) / 10 : 0,
    }));

    setStableCache(res);
    res.status(200).json({ items, total });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
