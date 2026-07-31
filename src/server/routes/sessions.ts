// api/sessions.ts
import {
  MDS_PARTNER_SCOPE,
  requireBasicAuth,
  requireMenuAccess,
  scopedGroupNames,
  scopedPartnerBrokerId,
} from "../../../lib/basic-auth";
import { CORE_DATA_MENUS } from "../../dashboard/menu-catalog";
import { createSqlParams, getCell, quoteIdent, resolveWarehouseId, runQuery, toInt, type SqlParams } from "../../../lib/databricks";
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

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const MESSAGE_TABLE = `hive_metastore.sanus_prod.botmaker_message`;
const DASHBOARD_SESSIONS_TABLE = `hive_metastore.sanus_prod.dashboard_sessions_base_gold`;
const BENEFICIARIES_TABLE = `hive_metastore.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function dashboardSessionsInlineSql() {
  return `(
    SELECT
      CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id,
      try_cast(s.${quoteIdent('creation_time')} AS TIMESTAMP) AS creation_ts,
      DATE_FORMAT(try_cast(s.${quoteIdent('creation_time')} AS TIMESTAMP), 'yyyy-MM') AS mes,
      DATE_FORMAT(try_cast(s.${quoteIdent('creation_time')} AS TIMESTAMP), 'yyyy-MM-dd') AS dia,
      CAST(s.${quoteIdent('organization_id')} AS STRING) AS organization_id,
      NULLIF(TRIM(CAST(o.${quoteIdent('name')} AS STRING)), '') AS organization_name,
      CASE
        WHEN s.${quoteIdent('economic_group_name')} IS NULL OR TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING)) = ''
        THEN 'Nulos'
        ELSE TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING))
      END AS economic_group_name,
      COALESCE(
        NULLIF(TRIM(CAST(o.${quoteIdent('name_economic_group')} AS STRING)), ''),
        NULLIF(TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING)), ''),
        'Nulos'
      ) AS economic_group_canonical,
      CASE
        WHEN s.${quoteIdent('variables')}['typification'] IS NULL THEN '(NULO)'
        WHEN TRIM(CAST(s.${quoteIdent('variables')}['typification'] AS STRING)) = '' THEN '(VAZIO/BRANCO)'
        ELSE TRIM(CAST(s.${quoteIdent('variables')}['typification'] AS STRING))
      END AS tipificacao,
      CASE WHEN s.${quoteIdent('finished_by')} IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_finished_by,
      CASE WHEN s.${quoteIdent('finished_by')} IS NOT NULL THEN 1 ELSE 0 END AS teve_humano_agent,
      CASE WHEN s.${quoteIdent('finished_by')} IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento_agent,
      COALESCE(
        CASE
          WHEN NULLIF(TRIM(CAST(COALESCE(
            s.${quoteIdent('variables')}['beneficiary_id'],
            s.${quoteIdent('variables')}['beneficiaryId'],
            s.${quoteIdent('variables')}['beneficiario_id'],
            s.${quoteIdent('variables')}['id_beneficiario'],
            s.${quoteIdent('variables')}['user_id'],
            s.${quoteIdent('variables')}['userId'],
            s.${quoteIdent('variables')}['customer_id'],
            s.${quoteIdent('variables')}['customerId']
          ) AS STRING)), '') IS NOT NULL
          THEN CONCAT('beneficiary:', NULLIF(TRIM(CAST(COALESCE(
            s.${quoteIdent('variables')}['beneficiary_id'],
            s.${quoteIdent('variables')}['beneficiaryId'],
            s.${quoteIdent('variables')}['beneficiario_id'],
            s.${quoteIdent('variables')}['id_beneficiario'],
            s.${quoteIdent('variables')}['user_id'],
            s.${quoteIdent('variables')}['userId'],
            s.${quoteIdent('variables')}['customer_id'],
            s.${quoteIdent('variables')}['customerId']
          ) AS STRING)), ''))
        END,
        CASE
          WHEN NULLIF(REGEXP_REPLACE(CAST(COALESCE(
            s.${quoteIdent('variables')}['cpf'],
            s.${quoteIdent('variables')}['CPF'],
            s.${quoteIdent('variables')}['document'],
            s.${quoteIdent('variables')}['documento'],
            s.${quoteIdent('variables')}['cpf_cnpj'],
            s.${quoteIdent('variables')}['document_number'],
            s.${quoteIdent('variables')}['beneficiary_cpf'],
            s.${quoteIdent('variables')}['cpf_beneficiario'],
            s.${quoteIdent('variables')}['cpf_beneficiary']
          ) AS STRING), '[^0-9]', ''), '') IS NOT NULL
          THEN CONCAT('cpf:', NULLIF(REGEXP_REPLACE(CAST(COALESCE(
            s.${quoteIdent('variables')}['cpf'],
            s.${quoteIdent('variables')}['CPF'],
            s.${quoteIdent('variables')}['document'],
            s.${quoteIdent('variables')}['documento'],
            s.${quoteIdent('variables')}['cpf_cnpj'],
            s.${quoteIdent('variables')}['document_number'],
            s.${quoteIdent('variables')}['beneficiary_cpf'],
            s.${quoteIdent('variables')}['cpf_beneficiario'],
            s.${quoteIdent('variables')}['cpf_beneficiary']
          ) AS STRING), '[^0-9]', ''), ''))
        END
      ) AS beneficiary_key
    FROM ${SESSION_TABLE} s
    LEFT JOIN ${ORGANIZATIONS_TABLE} o
      ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)
    WHERE s.${quoteIdent('creation_time')} IS NOT NULL
  )`;
}

type DashboardSessionsCache = { warehouseId: string; sql: string; usingGold: boolean };
let dashboardSessionsTableCache: DashboardSessionsCache | null = null;

async function resolveDashboardSessionsTable(warehouseId: string) {
  if (dashboardSessionsTableCache && dashboardSessionsTableCache.warehouseId === warehouseId) {
    return dashboardSessionsTableCache.sql;
  }
  try {
    await runQuery(warehouseId, `SELECT 1 FROM ${DASHBOARD_SESSIONS_TABLE} LIMIT 0`);
    dashboardSessionsTableCache = { warehouseId, sql: DASHBOARD_SESSIONS_TABLE, usingGold: true };
  } catch {
    dashboardSessionsTableCache = { warehouseId, sql: dashboardSessionsInlineSql(), usingGold: false };
  }
  return dashboardSessionsTableCache.sql;
}

function sessionTypificationExpr(variablesColumn: string, tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const raw = `${prefix}${quoteIdent(variablesColumn)}['typification']`;
  return `CASE
    WHEN ${raw} IS NULL THEN '(NULO)'
    WHEN TRIM(CAST(${raw} AS STRING)) = '' THEN '(VAZIO/BRANCO)'
    ELSE TRIM(CAST(${raw} AS STRING))
  END`;
}

function economicGroupNamesCondition(groupNames: string[], p: SqlParams, tableAlias = 's') {
  const names = groupNames.map((name) => String(name || '').trim()).filter(Boolean);
  if (!names.length) return null;
  const col = `${tableAlias}.${quoteIdent('economic_group_canonical')}`;
  const orgIdCol = `CAST(${tableAlias}.${quoteIdent('organization_id')} AS STRING)`;
  const nameMarkers = names.map((name) => p.add(name));
  const nameList = nameMarkers.map((marker) => `UPPER(TRIM(${marker}))`).join(',');
  const literalRows = nameMarkers.map((marker, index) => `${index ? 'UNION ALL ' : ''}SELECT UPPER(TRIM(${marker})) AS group_name`).join('\n    ');
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

function companySessionCondition(company: unknown, p: SqlParams, tableAlias = 's') {
  const name = String(company || '').trim();
  if (!name) return null;
  const c = p.add(name);
  return `(
    UPPER(TRIM(CAST(${tableAlias}.${quoteIdent('organization_name')} AS STRING))) = UPPER(TRIM(${c}))
    OR CAST(${tableAlias}.${quoteIdent('organization_id')} AS STRING) IN (
      SELECT CAST(id AS STRING)
      FROM ${ORGANIZATIONS_TABLE}
      WHERE UPPER(TRIM(CAST(name AS STRING))) = UPPER(TRIM(${c}))
    )
    OR CAST(${tableAlias}.${quoteIdent('organization_id')} AS STRING) IN (
      SELECT CAST(ID_EMPRESA AS STRING)
      FROM ${BENEFICIARIES_TABLE}
      WHERE UPPER(TRIM(CAST(NOME_CLIENTE AS STRING))) = UPPER(TRIM(${c}))
    )
  )`;
}

function partnerBrokerCondition(partnerBrokerId: unknown, p: SqlParams, tableAlias = 's') {
  const id = String(partnerBrokerId || '').trim();
  if (!id) return null;
  const partnerCondition = id === MDS_PARTNER_SCOPE
    ? `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`
    : `CAST(opb.partner_broker_id AS STRING) = ${p.add(id)}`;
  return `CAST(${tableAlias}.${quoteIdent('organization_id')} AS STRING) IN (
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

function lastNMonthsList(n: number) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setUTCMonth(d.getUTCMonth() - i);
    out.push(`${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, CORE_DATA_MENUS)) return;

  const meses = req.query.meses ? req.query.meses.split(',').filter((m: string) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupNames = scopedGroupNames(req, parseGroupNames(req.query));
  const company = req.query.company || null;
  const partnerBrokerId = scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const typificationFinisher = ['humano', 'ia'].includes(String(req.query.typification_finisher || '').toLowerCase())
    ? String(req.query.typification_finisher).toLowerCase()
    : '';
  const scope = String(req.query.scope || '').toLowerCase();
  const typificationValue = req.query.typification_value ? String(req.query.typification_value) : null;

  const SESSION_DATE_COLUMN = 'creation_time';

  const buildSessionDateFilter = (mesesArr: string[]) => mesesArr.length > 0
    ? `DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${mesesArr.map((m) => `'${m}'`).join(',')})`
    : null;

  try {
    const warehouseId = await resolveWarehouseId();
    const dashboardSessionsTable = await resolveDashboardSessionsTable(warehouseId);
    const params = createSqlParams();

    const companySessionsDateFilter = meses.length > 0
      ? `s.${quoteIdent('mes')} IN (${meses.map((m: string) => `'${m}'`).join(',')})`
      : null;
    const scopeFilters = [
      company ? companySessionCondition(company, params, 's') : economicGroupNamesCondition(groupNames, params, 's'),
      partnerBrokerCondition(partnerBrokerId, params, 's'),
    ].filter(Boolean);
    const companySessionsScopeFilter = scopeFilters.length ? scopeFilters.join(' AND ') : null;
    const companySessionsWhere = [companySessionsDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ');
    const companySessionsMode = groupNames.length || company || partnerBrokerId ? "company" : "economic_group";
    const companySessionsSource = companySessionsMode === "company"
      ? "dashboard_sessions_base_gold.organization_name"
      : "dashboard_sessions_base_gold.economic_group_canonical";
    const typificationFinisherFilter = typificationFinisher === 'humano'
      ? `s.${quoteIdent('tipo_atendimento_agent')} = 'Humano'`
      : (typificationFinisher === 'ia' ? `s.${quoteIdent('tipo_atendimento_agent')} = 'IA'` : null);

    if (scope === 'total') {
      const where = [companySessionsDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ');
      const rows = await runQuery(warehouseId, `
        SELECT COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${where ? `WHERE ${where}` : ''}
      `, params.list);
      setStableCache(res);
      return res.status(200).json({
        scope: 'total',
        total_sessions: toInt(rows[0]?.[0]),
        filters_applied: {
          period: meses.length > 0,
          organization: Boolean(groupNames.length || company || partnerBrokerId),
        },
        source: 'dashboard_sessions_base_gold',
      });
    }

    if (scope === 'unique_users') {
      const where = [companySessionsDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ');
      const rows = await runQuery(warehouseId, `
        SELECT COUNT(DISTINCT s.${quoteIdent('beneficiary_key')}) AS unique_users
        FROM ${dashboardSessionsTable} s
        ${where ? `WHERE ${where} AND s.${quoteIdent('beneficiary_key')} IS NOT NULL` : `WHERE s.${quoteIdent('beneficiary_key')} IS NOT NULL`}
      `, params.list);
      setStableCache(res);
      return res.status(200).json({
        scope: 'unique_users',
        unique_users: toInt(rows[0]?.[0]),
        filters_applied: {
          period: meses.length > 0,
          organization: Boolean(groupNames.length || company || partnerBrokerId),
        },
        source: 'dashboard_sessions_base_gold.beneficiary_key',
      });
    }

    if (scope === 'human_interaction') {
      const where = [companySessionsDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ');
      const rows = await runQuery(warehouseId, `
        SELECT
          s.${quoteIdent('tipo_atendimento_agent')} AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${where ? `WHERE ${where}` : ''}
        GROUP BY s.${quoteIdent('tipo_atendimento_agent')}
        ORDER BY total_sessions DESC
      `, params.list);
      setStableCache(res);
      return res.status(200).json({
        scope: 'human_interaction',
        message_agent_finishers: rows.map((row) => ({
          tipo: String(getCell(row[0]) || 'IA'),
          total: toInt(row[1]),
        })),
        filters_applied: {
          period: meses.length > 0,
          organization: Boolean(groupNames.length || company || partnerBrokerId),
        },
        source: "dashboard_sessions_base_gold.tipo_atendimento_agent",
      });
    }

    if (scope === 'typification_groups' && typificationValue) {
      const tipFilter = `s.${quoteIdent('tipificacao')} = ${params.add(typificationValue)}`;
      const where = [companySessionsDateFilter, companySessionsScopeFilter, typificationFinisherFilter, tipFilter]
        .filter(Boolean)
        .join(' AND ');
      try {
        const rows = await runQuery(warehouseId, `
          SELECT
            s.${quoteIdent('economic_group_canonical')} AS grupo,
            COUNT(*) AS total_sessions
          FROM ${dashboardSessionsTable} s
          WHERE ${where}
            AND s.${quoteIdent('economic_group_canonical')} IS NOT NULL
            AND TRIM(CAST(s.${quoteIdent('economic_group_canonical')} AS STRING)) != ''
          GROUP BY s.${quoteIdent('economic_group_canonical')}
          ORDER BY total_sessions DESC
          LIMIT 50
        `, params.list);
        const groups = rows.map((r) => ({
          grupo: String(getCell(r[0]) || 'Sem grupo'),
          total: toInt(r[1]),
        }));
        const totalSessions = groups.reduce((acc, g) => acc + g.total, 0);
        return res.status(200).json({
          scope: 'typification_groups',
          typification: typificationValue,
          groups,
          total: totalSessions,
          filters_applied: {
            period: meses.length > 0,
            organization: Boolean(groupNames.length || company || partnerBrokerId),
            finisher: Boolean(typificationFinisher),
          },
          finisher: typificationFinisher || null,
          source: 'dashboard_sessions_base_gold.economic_group_canonical',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(200).json({
          scope: 'typification_groups',
          typification: typificationValue,
          groups: [],
          total: 0,
          error: msg,
        });
      }
    }

    const topGroupMonths = meses.length ? [...meses].sort() : lastNMonthsList(12);
    const topGroupDateFilter = `s.${quoteIdent('mes')} IN (${topGroupMonths.map((m) => `'${m}'`).join(',')})`;
    const topGroupByCompany = Boolean(groupNames.length || company || partnerBrokerId);
    const topGroupNameExpr = topGroupByCompany
      ? `COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent('organization_name')} AS STRING)), ''), 'Sem empresa')`
      : `TRIM(CAST(s.${quoteIdent('economic_group_canonical')} AS STRING))`;
    const topGroupValidFilter = `${topGroupNameExpr} IS NOT NULL AND ${topGroupNameExpr} != ''`;
    const topGroupWhere = [topGroupDateFilter, companySessionsScopeFilter, topGroupValidFilter].filter(Boolean).join(' AND ');
    const topGroupFromSql = `${dashboardSessionsTable} s`;

    const messageAgentFinishersPromise = companySessionsMode === "company"
      ? runQuery(warehouseId, `
        SELECT
          s.${quoteIdent('tipo_atendimento_agent')} AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${companySessionsWhere ? `WHERE ${companySessionsWhere}` : ''}
        GROUP BY s.${quoteIdent('tipo_atendimento_agent')}
        ORDER BY total_sessions DESC
      `, params.list)
      : runQuery(warehouseId, `
        SELECT
          s.${quoteIdent('tipo_atendimento_agent')} AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${companySessionsDateFilter ? `WHERE ${companySessionsDateFilter}` : ''}
        GROUP BY s.${quoteIdent('tipo_atendimento_agent')}
        ORDER BY total_sessions DESC
      `);

    const companySessionsPromise = companySessionsMode === "company"
      ? runQuery(warehouseId, `
        SELECT
          COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent('organization_name')} AS STRING)), ''), 'Sem empresa') AS empresa,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${companySessionsWhere ? `WHERE ${companySessionsWhere}` : ''}
        GROUP BY COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent('organization_name')} AS STRING)), ''), 'Sem empresa')
        ORDER BY total_sessions DESC
      `, params.list)
      : runQuery(warehouseId, `
        SELECT
          s.${quoteIdent('economic_group_canonical')} AS empresa,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${companySessionsDateFilter ? `WHERE ${companySessionsDateFilter}` : ''}
        GROUP BY s.${quoteIdent('economic_group_canonical')}
        ORDER BY total_sessions DESC
      `);

    const typificationsPromise = companySessionsMode === "company"
      ? runQuery(warehouseId, `
        SELECT
          s.${quoteIdent('tipificacao')} AS tipificacao,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${[companySessionsWhere, typificationFinisherFilter].filter(Boolean).length ? `WHERE ${[companySessionsWhere, typificationFinisherFilter].filter(Boolean).join(' AND ')}` : ''}
        GROUP BY s.${quoteIdent('tipificacao')}
        ORDER BY total_sessions DESC
        LIMIT 30
      `, params.list)
      : runQuery(warehouseId, `
        SELECT
          s.${quoteIdent('tipificacao')} AS tipificacao,
          COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${[companySessionsDateFilter, typificationFinisherFilter].filter(Boolean).length ? `WHERE ${[companySessionsDateFilter, typificationFinisherFilter].filter(Boolean).join(' AND ')}` : ''}
        GROUP BY s.${quoteIdent('tipificacao')}
        ORDER BY total_sessions DESC
        LIMIT 30
      `, params.list);

    const topGroupsEvolutionPromise = topGroupByCompany ? runQuery(warehouseId, `
      WITH scoped_sessions AS (
        SELECT
          s.${quoteIdent('mes')} AS mes,
          COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent('organization_name')} AS STRING)), ''), 'Sem empresa') AS grupo
        FROM ${dashboardSessionsTable} s
        WHERE ${[topGroupDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ')}
      ),
      latest_month AS (
        SELECT MAX(mes) AS mes
        FROM scoped_sessions
      ),
      top_groups AS (
        SELECT
          ss.grupo,
          COUNT(*) AS current_sessions
        FROM scoped_sessions ss
        INNER JOIN latest_month lm ON lm.mes = ss.mes
        WHERE ss.grupo IS NOT NULL AND ss.grupo != ''
        GROUP BY ss.grupo
        ORDER BY current_sessions DESC
        LIMIT 5
      )
      SELECT
        ss.mes,
        ss.grupo,
        COUNT(*) AS total_sessions,
        tg.current_sessions
      FROM scoped_sessions ss
      INNER JOIN top_groups tg ON tg.grupo = ss.grupo
      GROUP BY ss.mes, ss.grupo, tg.current_sessions
      ORDER BY tg.current_sessions DESC, ss.grupo, ss.mes
    `, params.list) : runQuery(warehouseId, `
      WITH scoped_sessions AS (
        SELECT
          s.${quoteIdent('mes')} AS mes,
          ${topGroupNameExpr} AS grupo
        FROM ${topGroupFromSql}
        WHERE ${topGroupWhere}
      ),
      latest_month AS (
        SELECT MAX(mes) AS mes
        FROM scoped_sessions
      ),
      top_groups AS (
        SELECT
          ss.grupo,
          COUNT(*) AS current_sessions
        FROM scoped_sessions ss
        INNER JOIN latest_month lm ON lm.mes = ss.mes
        GROUP BY ss.grupo
        ORDER BY current_sessions DESC
        LIMIT 5
      )
      SELECT
        s.mes,
        s.grupo,
        COUNT(*) AS total_sessions,
        tg.current_sessions
      FROM scoped_sessions s
      INNER JOIN top_groups tg ON tg.grupo = s.grupo
      GROUP BY s.mes, s.grupo, tg.current_sessions
      ORDER BY tg.current_sessions DESC, s.grupo, s.mes
    `, params.list);

    const [typificationsSettled, messageAgentFinishersSettled, companySessionsSettled, topGroupsEvolutionSettled] = await Promise.allSettled([
      typificationsPromise,
      messageAgentFinishersPromise,
      companySessionsPromise,
      topGroupsEvolutionPromise,
    ]);

    const typificationsError = typificationsSettled.status === 'rejected'
      ? (typificationsSettled.reason instanceof Error ? typificationsSettled.reason.message : String(typificationsSettled.reason))
      : null;
    const typifications = typificationsSettled.status === 'fulfilled'
      ? typificationsSettled.value.map((r) => ({
          tipo: String(getCell(r[0]) || "—"),
          total: toInt(r[1]),
        }))
      : [];
    const messageAgentFinishersError = messageAgentFinishersSettled.status === 'rejected'
      ? (messageAgentFinishersSettled.reason instanceof Error ? messageAgentFinishersSettled.reason.message : String(messageAgentFinishersSettled.reason))
      : null;
    const messageAgentFinishers = messageAgentFinishersSettled.status === 'fulfilled'
      ? messageAgentFinishersSettled.value.map((r) => ({
          tipo: String(getCell(r[0]) || "—"),
          total: toInt(r[1]),
        }))
      : [];
    const companySessionsError = companySessionsSettled.status === 'rejected'
      ? (companySessionsSettled.reason instanceof Error ? companySessionsSettled.reason.message : String(companySessionsSettled.reason))
      : null;
    const companySessions = companySessionsSettled.status === 'fulfilled'
      ? companySessionsSettled.value.map((r) => ({
          empresa: String(getCell(r[0]) || "Sem empresa"),
          total: toInt(r[1]),
        }))
      : [];
    const companySessionsTotal = companySessions.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
    const economicGroupTotal = companySessionsSettled.status === 'fulfilled' ? companySessionsTotal : 0;
    const economicGroupTotalError = companySessionsError;
    const topGroupsEvolutionError = topGroupsEvolutionSettled.status === 'rejected'
      ? (topGroupsEvolutionSettled.reason instanceof Error ? topGroupsEvolutionSettled.reason.message : String(topGroupsEvolutionSettled.reason))
      : null;
    const topGroupsEvolutionRows = topGroupsEvolutionSettled.status === 'fulfilled'
      ? topGroupsEvolutionSettled.value.map((r) => ({
          mes: String(getCell(r[0]) || ''),
          grupo: String(getCell(r[1]) || ''),
          total: toInt(r[2]),
          current_total: toInt(r[3]),
        }))
      : [];
    const topGroups = [...new Set(topGroupsEvolutionRows.map((row) => row.grupo))];

    setStableCache(res);
    res.status(200).json({
      economic_group_total: economicGroupTotal,
      economic_group_total_error: economicGroupTotalError,
      company_sessions: companySessions,
      company_sessions_error: companySessionsError,
      company_sessions_mode: companySessionsMode,
      company_sessions_source: companySessionsSource,
      message_agent_finishers: messageAgentFinishers,
      message_agent_finishers_error: messageAgentFinishersError,
      message_agent_finishers_filter_applied: { period: true, organization: true },
      typifications,
      typifications_error: typificationsError,
      typifications_finisher: typificationFinisher,
      typifications_filter_applied: { period: true, organization: true, finisher: Boolean(typificationFinisher) },
      top_groups_evolution: {
        months: topGroupMonths,
        groups: topGroups,
        series: topGroupsEvolutionRows,
        error: topGroupsEvolutionError,
        source: topGroupByCompany ? "botmaker_session.economic_group_name + organizations.name" : "botmaker_session.economic_group_name",
        dimension: topGroupByCompany ? "company" : "economic_group",
        ranking: topGroupByCompany ? "top_5_companies_latest_month_non_null" : "top_5_latest_month_non_null",
      },
      period_filter_applied: meses.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
