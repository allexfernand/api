// #VP04 — Tendência de sessões do grupo econômico + ranking de empresas
// para reativar (queda de volume + potencial por vidas/engajamento).
import {
  MDS_PARTNER_SCOPE,
  requireBasicAuth,
  requireMenuAccess,
  scopedGroupNames,
  scopedPartnerBrokerId,
  scopedPartnerBrokerIds,
} from "../../../lib/basic-auth";
import { createSqlParams, getCell, quoteIdent, resolveWarehouseId, runQuery, toInt, type SqlParams } from "../../../lib/databricks";
import { setApiCors, setStableCache } from "../../../lib/http";

type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const DASHBOARD_SESSIONS_TABLE = `hive_metastore.sanus_prod.dashboard_sessions_base_gold`;
const BENEFICIARIES_VIEW = `hive_metastore.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

type DashboardSessionsCache = { warehouseId: string; sql: string };
let dashboardSessionsTableCache: DashboardSessionsCache | null = null;

function dashboardSessionsInlineSql() {
  return `(
    SELECT
      DATE_FORMAT(try_cast(s.${quoteIdent("creation_time")} AS TIMESTAMP), 'yyyy-MM') AS mes,
      CAST(s.${quoteIdent("organization_id")} AS STRING) AS organization_id,
      NULLIF(TRIM(CAST(o.${quoteIdent("name")} AS STRING)), '') AS organization_name,
      COALESCE(
        NULLIF(TRIM(CAST(o.${quoteIdent("name_economic_group")} AS STRING)), ''),
        NULLIF(TRIM(CAST(s.${quoteIdent("economic_group_name")} AS STRING)), ''),
        'Nulos'
      ) AS economic_group_canonical
    FROM ${SESSION_TABLE} s
    LEFT JOIN ${ORGANIZATIONS_TABLE} o
      ON CAST(s.${quoteIdent("organization_id")} AS STRING) = CAST(o.${quoteIdent("id")} AS STRING)
    WHERE s.${quoteIdent("creation_time")} IS NOT NULL
  )`;
}

async function resolveDashboardSessionsTable(warehouseId: string) {
  if (dashboardSessionsTableCache && dashboardSessionsTableCache.warehouseId === warehouseId) {
    return dashboardSessionsTableCache.sql;
  }
  try {
    await runQuery(warehouseId, `SELECT 1 FROM ${DASHBOARD_SESSIONS_TABLE} LIMIT 0`);
    dashboardSessionsTableCache = { warehouseId, sql: DASHBOARD_SESSIONS_TABLE };
  } catch {
    dashboardSessionsTableCache = { warehouseId, sql: dashboardSessionsInlineSql() };
  }
  return dashboardSessionsTableCache.sql;
}

function parseGroupNames(query: Record<string, unknown>) {
  const raw = query.group_names;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return [...new Set(parsed.map((value) => String(value).trim()).filter(Boolean))];
    } catch {}
  }
  return query.group_name ? [String(query.group_name).trim()].filter(Boolean) : [];
}

function lastNMonthsList(n: number) {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setUTCMonth(d.getUTCMonth() - i);
    out.push(`${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function parseWindowMonths(query: Record<string, unknown>) {
  const raw = Number(query.window || query.months || 6);
  if (raw === 3 || raw === 12) return raw;
  return 6;
}

async function parsePartnerBrokerIds(req: ApiRequest, fallback: unknown) {
  if (fallback === MDS_PARTNER_SCOPE) return fallback;
  if (req.query.partner_broker_ids) {
    try {
      const parsed = JSON.parse(String(req.query.partner_broker_ids));
      if (Array.isArray(parsed)) {
        const requested = [...new Set(parsed.map((value) => String(value).trim()).filter(Boolean))];
        if (requested.length) return scopedPartnerBrokerIds(req, requested);
      }
    } catch {}
  }
  return fallback ? fallback : null;
}

function partnerBrokerCondition(partnerBrokerId: unknown, p: SqlParams, tableAlias = "s") {
  const partnerIds = Array.isArray(partnerBrokerId)
    ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const id = String(partnerBrokerId || "").trim();
  if (!partnerIds.length && !id) return null;
  const partnerCondition = partnerIds.length
    ? `CAST(opb.partner_broker_id AS STRING) IN (${p.addAll(partnerIds)})`
    : id === MDS_PARTNER_SCOPE
      ? `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`
      : `CAST(opb.partner_broker_id AS STRING) = ${p.add(id)}`;
  return `CAST(${tableAlias}.${quoteIdent("organization_id")} AS STRING) IN (
    SELECT CAST(opb.organization_id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION ALL
    SELECT CAST(child.id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function economicGroupNamesCondition(groupNames: string[], p: SqlParams, tableAlias = "s") {
  const names = groupNames.map((name) => String(name || "").trim()).filter(Boolean);
  if (!names.length) return null;
  const col = `${tableAlias}.${quoteIdent("economic_group_canonical")}`;
  const orgIdCol = `CAST(${tableAlias}.${quoteIdent("organization_id")} AS STRING)`;
  const nameMarkers = names.map((name) => p.add(name));
  const nameList = nameMarkers.map((marker) => `UPPER(TRIM(${marker}))`).join(",");
  const literalRows = nameMarkers.map((marker, index) => `${index ? "UNION ALL " : ""}SELECT UPPER(TRIM(${marker})) AS group_name`).join("\n    ");
  const matchedOrgs = `
    SELECT CAST(id AS STRING) AS id
    FROM ${ORGANIZATIONS_TABLE}
    WHERE active = true AND UPPER(TRIM(CAST(name AS STRING))) IN (${nameList})
  `;
  return `(
    UPPER(TRIM(CAST(${col} AS STRING))) IN (
      SELECT UPPER(TRIM(CAST(COALESCE(NULLIF(TRIM(CAST(name_economic_group AS STRING)), ''), name) AS STRING)))
      FROM ${ORGANIZATIONS_TABLE}
      WHERE active = true AND UPPER(TRIM(CAST(name AS STRING))) IN (${nameList})
      UNION
      ${literalRows}
    )
    OR ${orgIdCol} IN (
      SELECT id FROM (${matchedOrgs}) matched
      UNION ALL
      SELECT CAST(child.id AS STRING)
      FROM ${ORGANIZATIONS_TABLE} child
      INNER JOIN (${matchedOrgs}) matched
        ON CAST(child.matriz_id AS STRING) = matched.id
    )
  )`;
}

function partnerOrgIdsSubquery(partnerBrokerId: unknown, p: SqlParams) {
  const partnerCondition = (() => {
    const partnerIds = Array.isArray(partnerBrokerId)
      ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
      : [];
    if (partnerIds.length) return `CAST(opb.partner_broker_id AS STRING) IN (${p.addAll(partnerIds)})`;
    if (String(partnerBrokerId) === MDS_PARTNER_SCOPE) {
      return `CAST(opb.partner_broker_id AS STRING) IN (
        SELECT CAST(pb.id AS STRING)
        FROM ${PARTNER_BROKERS_TABLE} pb
        WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
          OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
      )`;
    }
    return `CAST(opb.partner_broker_id AS STRING) = ${p.add(partnerBrokerId)}`;
  })();
  return `(
    SELECT CAST(opb.organization_id AS STRING) AS organization_id
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION ALL
    SELECT CAST(child.id AS STRING) AS organization_id
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildReason(declinePct: number, engagement: number, groupEngagement: number, lives: number) {
  const parts: string[] = [];
  if (declinePct >= 0.15) parts.push(`queda de ${(declinePct * 100).toFixed(0)}% nas sessões`);
  else if (declinePct > 0) parts.push(`leve queda de ${(declinePct * 100).toFixed(0)}% nas sessões`);
  if (lives > 0 && groupEngagement > 0 && engagement < groupEngagement * 0.85) {
    parts.push(`engajamento abaixo da média do grupo (${engagement.toFixed(2)} vs ${groupEngagement.toFixed(2)} sessões/vida)`);
  } else if (lives > 0) {
    parts.push(`${engagement.toFixed(2)} sessões por vida · ${lives.toLocaleString("pt-BR")} vidas`);
  }
  if (!parts.length) parts.push("potencial de reativação moderado");
  return parts.join(" · ");
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, ["visao-parceiros"])) return;

  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));
  if (!groupNames.length) {
    return res.status(400).json({ error: "Selecione um grupo econômico para analisar." });
  }

  const windowMonths = parseWindowMonths(req.query);
  const months = lastNMonthsList(windowMonths);
  const scopedPartner = await scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const partnerBrokerId = await parsePartnerBrokerIds(req, scopedPartner);
  const params = createSqlParams();
  const groupFilter = economicGroupNamesCondition(groupNames, params, "s");
  const partnerFilter = partnerBrokerCondition(partnerBrokerId, params, "s");
  const monthFilter = `s.${quoteIdent("mes")} IN (${months.map((month) => `'${month}'`).join(",")})`;
  const sessionWhere = [monthFilter, groupFilter, partnerFilter].filter(Boolean).join(" AND ");

  const livesParams = createSqlParams();
  const groupList = livesParams.addAll(groupNames);
  const livesFilters = [
    `b.NOME_CLIENTE IS NOT NULL`,
    `TRIM(CAST(b.NOME_CLIENTE AS STRING)) != ''`,
    `b.ID_EMPRESA IN (
      SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE TRIM(name) IN (${groupList})
      UNION
      SELECT id FROM ${ORGANIZATIONS_TABLE}
      WHERE matriz_id IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE TRIM(name) IN (${groupList}))
    )`,
  ];
  let livesPartnerCte = "";
  let livesPartnerJoin = "";
  if (partnerBrokerId) {
    livesPartnerCte = `WITH partner_orgs AS ${partnerOrgIdsSubquery(partnerBrokerId, livesParams)}`;
    livesPartnerJoin = `INNER JOIN (SELECT DISTINCT organization_id FROM partner_orgs) po
      ON CAST(b.ID_EMPRESA AS STRING) = po.organization_id`;
  }

  try {
    const warehouseId = await resolveWarehouseId();
    const dashboardSessionsTable = await resolveDashboardSessionsTable(warehouseId);

    const [seriesRows, companyMonthRows, livesRows] = await Promise.all([
      runQuery(
        warehouseId,
        `
        SELECT
          s.${quoteIdent("mes")} AS mes,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        WHERE ${sessionWhere}
        GROUP BY s.${quoteIdent("mes")}
        ORDER BY mes
      `,
        params.list,
      ),
      runQuery(
        warehouseId,
        `
        SELECT
          COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent("organization_name")} AS STRING)), ''), 'Sem empresa') AS empresa,
          s.${quoteIdent("mes")} AS mes,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        WHERE ${sessionWhere}
        GROUP BY 1, 2
      `,
        params.list,
      ),
      runQuery(
        warehouseId,
        `
        ${livesPartnerCte}
        SELECT
          TRIM(CAST(b.NOME_CLIENTE AS STRING)) AS empresa,
          COUNT(*) AS vidas
        FROM ${BENEFICIARIES_VIEW} b
        ${livesPartnerJoin}
        WHERE ${livesFilters.join(" AND ")}
        GROUP BY 1
      `,
        livesParams.list,
      ),
    ]);

    const seriesByMonth = new Map(months.map((month) => [month, 0]));
    for (const row of seriesRows) {
      const month = String(getCell(row[0]) || "");
      if (seriesByMonth.has(month)) seriesByMonth.set(month, toInt(row[1]));
    }
    const series = months.map((month) => ({ mes: month, sessions: seriesByMonth.get(month) || 0 }));

    const livesByCompany = new Map<string, number>();
    for (const row of livesRows) {
      const name = String(getCell(row[0]) || "").trim();
      if (!name) continue;
      livesByCompany.set(name, toInt(row[1]));
    }

    const sessionsByCompanyMonth = new Map<string, Map<string, number>>();
    for (const row of companyMonthRows) {
      const company = String(getCell(row[0]) || "").trim() || "Sem empresa";
      const month = String(getCell(row[1]) || "");
      const total = toInt(row[2]);
      if (!sessionsByCompanyMonth.has(company)) sessionsByCompanyMonth.set(company, new Map());
      sessionsByCompanyMonth.get(company)!.set(month, total);
    }

    const companyNames = new Set([...livesByCompany.keys(), ...sessionsByCompanyMonth.keys()]);
    const splitAt = Math.floor(months.length / 2);
    const priorMonths = months.slice(0, Math.max(splitAt, 1));
    const recentMonths = months.slice(Math.max(splitAt, 1));

    const draft = [...companyNames].map((company) => {
      const monthMap = sessionsByCompanyMonth.get(company) || new Map();
      const monthly = months.map((month) => monthMap.get(month) || 0);
      const sessionsTotal = monthly.reduce((sum, value) => sum + value, 0);
      const lives = livesByCompany.get(company) || 0;
      const priorAvg = avg(priorMonths.map((month) => monthMap.get(month) || 0));
      const recentAvg = avg(recentMonths.map((month) => monthMap.get(month) || 0));
      const declinePct = priorAvg > 0 ? Math.max(0, (priorAvg - recentAvg) / priorAvg) : 0;
      const engagement = lives > 0 ? sessionsTotal / lives : 0;
      return {
        company,
        lives,
        sessions_total: sessionsTotal,
        sessions_prior_avg: priorAvg,
        sessions_recent_avg: recentAvg,
        decline_pct: declinePct,
        engagement,
        monthly,
      };
    });

    const eligible = draft.filter((item) => item.lives >= 10 || item.sessions_total > 0);
    const groupSessions = eligible.reduce((sum, item) => sum + item.sessions_total, 0);
    const groupLives = eligible.reduce((sum, item) => sum + item.lives, 0);
    const groupEngagement = groupLives > 0 ? groupSessions / groupLives : 0;
    const maxLives = Math.max(...eligible.map((item) => item.lives), 1);

    const ranked = eligible
      .map((item) => {
        const livesNorm = Math.log1p(item.lives) / Math.log1p(maxLives);
        const engagementGap =
          groupEngagement > 0
            ? Math.max(0, Math.min(1, (groupEngagement - item.engagement) / groupEngagement))
            : item.lives > 0 && item.engagement === 0
              ? 1
              : 0;
        const potential = livesNorm * (0.35 + 0.65 * engagementGap);
        const score = 0.5 * item.decline_pct + 0.5 * potential;
        return {
          company: item.company,
          lives: item.lives,
          sessions_total: item.sessions_total,
          sessions_prior_avg: Number(item.sessions_prior_avg.toFixed(1)),
          sessions_recent_avg: Number(item.sessions_recent_avg.toFixed(1)),
          decline_pct: Number((item.decline_pct * 100).toFixed(1)),
          engagement: Number(item.engagement.toFixed(3)),
          score: Number(score.toFixed(4)),
          reason: buildReason(item.decline_pct, item.engagement, groupEngagement, item.lives),
        };
      })
      .filter((item) => item.score > 0.05)
      .sort((a, b) => b.score - a.score || b.lives - a.lives)
      .slice(0, 8);

    setStableCache(res);
    return res.status(200).json({
      group_name: groupNames[0],
      window_months: windowMonths,
      months,
      series,
      group_engagement: Number(groupEngagement.toFixed(3)),
      group_lives: groupLives,
      group_sessions: groupSessions,
      recommendations: ranked,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: (err as { message?: string }).message });
  }
}
