// api/sessions.ts
import {
  MDS_PARTNER_SCOPE,
  requireBasicAuth,
  requireMenuAccess,
  scopedGroupNames,
  scopedPartnerBrokerId,
  scopedPartnerBrokerIds,
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

async function parsePartnerBrokerSelection(req: ApiRequest, fallback: unknown) {
  if (fallback === MDS_PARTNER_SCOPE) return fallback;
  if (req.query.partner_broker_ids) {
    try {
      const parsed = JSON.parse(String(req.query.partner_broker_ids));
      if (Array.isArray(parsed)) {
        const requested = [...new Set(parsed.map((value) => String(value).trim()).filter(Boolean))];
        if (requested.length) return await scopedPartnerBrokerIds(req, requested);
      }
    } catch {}
  }
  return fallback ? fallback : null;
}

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const MESSAGE_TABLE = `hive_metastore.sanus_prod.botmaker_message`;
const DASHBOARD_SESSIONS_TABLE = `hive_metastore.sanus_prod.dashboard_sessions_base_gold`;
const BENEFICIARIES_TABLE = `hive_metastore.sanus_prod.vw_beneficiarios`;
const BENEFICIARIES_KINSHIP_TABLE = `hive_metastore.sanus_prod.beneficiaries`;
const USERS_DELETED_TABLE = `hive_metastore.sanus_prod.users_deleted`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function normalizeCpfSql(expr: string) {
  return `NULLIF(LPAD(REGEXP_REPLACE(CAST(${expr} AS STRING), '[^0-9]', ''), 11, '0'), '00000000000')`;
}

function deletedKinshipExpr(dataExpr = 'ud.data') {
  return `UPPER(TRIM(COALESCE(
    NULLIF(GET_JSON_OBJECT(CAST(${dataExpr} AS STRING), '$.type_kinship'), ''),
    NULLIF(GET_JSON_OBJECT(CAST(${dataExpr} AS STRING), '$.typeKinship'), ''),
    NULLIF(regexp_extract(CAST(${dataExpr} AS STRING), '(?i)"type_kinship"\\s*:\\s*"([^"]+)"', 1), '')
  )))`;
}

function sessionCpfFromVariablesExpr(alias = 'raw') {
  return `COALESCE(
    ${alias}.${quoteIdent('variables')}['cpf'],
    ${alias}.${quoteIdent('variables')}['CPF'],
    ${alias}.${quoteIdent('variables')}['document'],
    ${alias}.${quoteIdent('variables')}['documento'],
    ${alias}.${quoteIdent('variables')}['cpf_cnpj'],
    ${alias}.${quoteIdent('variables')}['document_number'],
    ${alias}.${quoteIdent('variables')}['beneficiary_cpf'],
    ${alias}.${quoteIdent('variables')}['cpf_beneficiario'],
    ${alias}.${quoteIdent('variables')}['cpf_beneficiary']
  )`;
}

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
  const partnerIds = Array.isArray(partnerBrokerId)
    ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const id = String(partnerBrokerId || '').trim();
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
  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));
  const company = req.query.company || null;
  const partnerBrokerId = await parsePartnerBrokerSelection(
    req,
    await scopedPartnerBrokerId(req, req.query.partner_broker_id || null),
  );
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

    if (scope === 'human_by_department') {
      const { groupSessionsByDepartment, listAttendantMappings } = await import("../attendants/service");
      // Mesma base do Q12B: só sessões Humano por tipo_atendimento_agent + mesmos filtros.
      const q12bWhere = companySessionsMode === "company"
        ? [companySessionsDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ')
        : (companySessionsDateFilter || '');

      try {
        const [mappingRows, attendantRows] = await Promise.all([
          listAttendantMappings(),
          runQuery(warehouseId, `
            WITH human_sessions AS (
              SELECT
                CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id
              FROM ${dashboardSessionsTable} s
              WHERE s.${quoteIdent('tipo_atendimento_agent')} = 'Humano'
                ${q12bWhere ? `AND ${q12bWhere}` : ''}
            ),
            with_attendant AS (
              SELECT
                h.session_id,
                COALESCE(
                  NULLIF(TRIM(CAST(MAX(b.${quoteIdent('finished_by')}) AS STRING)), ''),
                  '(Sem finished_by)'
                ) AS attendant
              FROM human_sessions h
              LEFT JOIN ${SESSION_TABLE} b
                ON CAST(b.${quoteIdent('session_id')} AS STRING) = h.session_id
              GROUP BY h.session_id
            )
            SELECT
              w.attendant AS attendant,
              COUNT(*) AS total_sessions
            FROM with_attendant w
            GROUP BY w.attendant
            ORDER BY total_sessions DESC
            LIMIT 2000
          `, companySessionsMode === "company" ? params.list : undefined),
        ]);

        const attendants = attendantRows.map((row) => ({
          attendant: String(getCell(row[0]) || '').trim() || '(Sem finished_by)',
          total: toInt(row[1]),
        })).filter((row) => row.attendant);

        const grouped = groupSessionsByDepartment(attendants, mappingRows);
        setStableCache(res);
        return res.status(200).json({
          scope: 'human_by_department',
          ...grouped,
          attendants: attendants.slice(0, 50),
          filters_applied: {
            period: meses.length > 0,
            organization: Boolean(groupNames.length || company || partnerBrokerId),
          },
          source: 'dashboard_sessions_base_gold.tipo_atendimento_agent + botmaker_session.finished_by',
          rule: 'Universo = Q12B Humano (tipo_atendimento_agent); departamento via finished_by',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(200).json({
          scope: 'human_by_department',
          departments: [],
          total: 0,
          attendants: [],
          error: msg,
        });
      }
    }

    if (scope === 'economic_groups_ranking') {
      const month = meses[0] && /^\d{4}-\d{2}$/.test(meses[0])
        ? meses[0]
        : lastNMonthsList(1)[0];
      const dateFilter = `s.${quoteIdent('mes')} = '${month}'`;
      const groupExpr = `COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent('economic_group_canonical')} AS STRING)), ''), 'Sem grupo')`;
      const where = [dateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ');
      try {
        const rows = await runQuery(warehouseId, `
          SELECT
            ${groupExpr} AS grupo,
            COUNT(*) AS total_sessions
          FROM ${dashboardSessionsTable} s
          ${where ? `WHERE ${where}` : ''}
          GROUP BY ${groupExpr}
          ORDER BY total_sessions DESC, grupo ASC
          LIMIT 300
        `, params.list);
        const groups = rows.map((row) => ({
          grupo: String(getCell(row[0]) || 'Sem grupo'),
          total: toInt(row[1]),
        })).filter((row) => row.total > 0);
        const total = groups.reduce((sum, item) => sum + item.total, 0);
        setStableCache(res);
        return res.status(200).json({
          scope: 'economic_groups_ranking',
          month,
          groups,
          total,
          filters_applied: {
            period: true,
            organization: Boolean(groupNames.length || company || partnerBrokerId),
          },
          source: 'dashboard_sessions_base_gold.economic_group_canonical',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(200).json({
          scope: 'economic_groups_ranking',
          month,
          groups: [],
          total: 0,
          error: msg,
        });
      }
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

    // Q15: janela fixa dos últimos 12 meses (igual Q3), sem impacto do filtro de data.
    const topGroupMonths = lastNMonthsList(12);
    const topGroupDateFilter = `s.${quoteIdent('mes')} IN (${topGroupMonths.map((m) => `'${m}'`).join(',')})`;
    const humanDeptEvolWhere = companySessionsMode === "company"
      ? [topGroupDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ')
      : topGroupDateFilter;

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

    const q12bKinshipWhere = companySessionsMode === "company"
      ? (companySessionsWhere || '')
      : (companySessionsDateFilter || '');
    const kinshipPromise = runQuery(warehouseId, `
      WITH scoped AS (
        SELECT
          CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id,
          CAST(s.${quoteIdent('beneficiary_key')} AS STRING) AS beneficiary_key
        FROM ${dashboardSessionsTable} s
        ${q12bKinshipWhere ? `WHERE ${q12bKinshipWhere}` : ''}
      ),
      with_identity AS (
        SELECT
          sc.session_id,
          CASE
            WHEN sc.beneficiary_key LIKE 'beneficiary:%'
            THEN NULLIF(TRIM(SUBSTRING(sc.beneficiary_key, 13)), '')
            ELSE NULL
          END AS beneficiary_id,
          COALESCE(
            CASE
              WHEN sc.beneficiary_key LIKE 'cpf:%'
              THEN ${normalizeCpfSql("SUBSTRING(sc.beneficiary_key, 5)")}
              ELSE NULL
            END,
            ${normalizeCpfSql(sessionCpfFromVariablesExpr('raw'))}
          ) AS cpf_norm
        FROM scoped sc
        LEFT JOIN ${SESSION_TABLE} raw
          ON CAST(raw.${quoteIdent('session_id')} AS STRING) = sc.session_id
      ),
      beneficiary_by_id AS (
        SELECT
          key_id AS beneficiary_id,
          CASE
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(type_kinship, ''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'Titular'
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(type_kinship, ''))) NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) = 1 THEN 'Dependente'
            ELSE NULL
          END AS tipo
        FROM (
          SELECT CAST(b.${quoteIdent('id')} AS STRING) AS key_id, b.type_kinship
          FROM ${BENEFICIARIES_KINSHIP_TABLE} b
          WHERE b.${quoteIdent('id')} IS NOT NULL
          UNION ALL
          SELECT CAST(b.${quoteIdent('beneficiary_id')} AS STRING) AS key_id, b.type_kinship
          FROM ${BENEFICIARIES_KINSHIP_TABLE} b
          WHERE b.${quoteIdent('beneficiary_id')} IS NOT NULL
          UNION ALL
          SELECT CAST(b.${quoteIdent('user_id')} AS STRING) AS key_id, b.type_kinship
          FROM ${BENEFICIARIES_KINSHIP_TABLE} b
          WHERE b.${quoteIdent('user_id')} IS NOT NULL
        ) keys
        WHERE key_id IS NOT NULL AND TRIM(key_id) != ''
        GROUP BY key_id
      ),
      beneficiary_types AS (
        SELECT
          ${normalizeCpfSql('b.cpf')} AS cpf_norm,
          CASE
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'Titular'
            WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) = 1 THEN 'Dependente'
            ELSE NULL
          END AS tipo
        FROM ${BENEFICIARIES_KINSHIP_TABLE} b
        WHERE b.cpf IS NOT NULL
          AND TRIM(CAST(b.cpf AS STRING)) != ''
        GROUP BY ${normalizeCpfSql('b.cpf')}
      ),
      deleted_types AS (
        SELECT
          ${normalizeCpfSql('ud.cpf')} AS cpf_norm,
          CASE
            WHEN MAX(CASE WHEN ${deletedKinshipExpr('ud.data')} = 'TITULAR' THEN 1 ELSE 0 END) = 1 THEN 'Titular'
            WHEN MAX(CASE WHEN ${deletedKinshipExpr('ud.data')} NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) = 1 THEN 'Dependente'
            ELSE NULL
          END AS tipo
        FROM ${USERS_DELETED_TABLE} ud
        WHERE ud.cpf IS NOT NULL
          AND TRIM(CAST(ud.cpf AS STRING)) != ''
        GROUP BY ${normalizeCpfSql('ud.cpf')}
      ),
      classified AS (
        SELECT
          CASE
            WHEN COALESCE(bi.tipo, bt.tipo, dt.tipo) IN ('Titular', 'Dependente')
              THEN COALESCE(bi.tipo, bt.tipo, dt.tipo)
            ELSE 'Sem CPF'
          END AS classe
        FROM with_identity w
        LEFT JOIN beneficiary_by_id bi
          ON bi.beneficiary_id = w.beneficiary_id
         AND w.beneficiary_id IS NOT NULL
        LEFT JOIN beneficiary_types bt
          ON bt.cpf_norm = w.cpf_norm
         AND w.cpf_norm IS NOT NULL
         AND bi.tipo IS NULL
        LEFT JOIN deleted_types dt
          ON dt.cpf_norm = w.cpf_norm
         AND w.cpf_norm IS NOT NULL
         AND bi.tipo IS NULL
         AND bt.tipo IS NULL
      )
      SELECT
        classe,
        COUNT(*) AS total_sessions
      FROM classified
      GROUP BY classe
      ORDER BY total_sessions DESC
    `, companySessionsMode === "company" ? params.list : undefined);

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

    const humanDepartmentEvolutionPromise = (async () => {
      const { groupSessionsEvolutionByDepartment, listAttendantMappings } = await import("../attendants/service");
      const queryParams = companySessionsMode === "company" ? params.list : undefined;
      const [mappingRows, attendantRows, monthlyTotalRows] = await Promise.all([
        listAttendantMappings(),
        runQuery(warehouseId, `
          WITH human_sessions AS (
            SELECT
              CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id,
              s.${quoteIdent('mes')} AS mes
            FROM ${dashboardSessionsTable} s
            WHERE s.${quoteIdent('tipo_atendimento_agent')} = 'Humano'
              ${humanDeptEvolWhere ? `AND ${humanDeptEvolWhere}` : ''}
          ),
          with_attendant AS (
            SELECT
              h.session_id,
              h.mes,
              COALESCE(
                NULLIF(TRIM(CAST(MAX(b.${quoteIdent('finished_by')}) AS STRING)), ''),
                '(Sem finished_by)'
              ) AS attendant
            FROM human_sessions h
            LEFT JOIN ${SESSION_TABLE} b
              ON CAST(b.${quoteIdent('session_id')} AS STRING) = h.session_id
            GROUP BY h.session_id, h.mes
          )
          SELECT
            w.mes AS mes,
            w.attendant AS attendant,
            COUNT(*) AS total_sessions
          FROM with_attendant w
          GROUP BY w.mes, w.attendant
          ORDER BY w.mes, total_sessions DESC
        `, queryParams),
        runQuery(warehouseId, `
          SELECT
            s.${quoteIdent('mes')} AS mes,
            COUNT(*) AS total_sessions
          FROM ${dashboardSessionsTable} s
          ${humanDeptEvolWhere ? `WHERE ${humanDeptEvolWhere}` : ''}
          GROUP BY s.${quoteIdent('mes')}
          ORDER BY s.${quoteIdent('mes')}
        `, queryParams),
      ]);

      const attendantSeries = attendantRows.map((row) => ({
        mes: String(getCell(row[0]) || '').trim(),
        attendant: String(getCell(row[1]) || '').trim() || '(Sem finished_by)',
        total: toInt(row[2]),
      })).filter((row) => row.mes && row.attendant);

      const monthlyTotals = monthlyTotalRows.map((row) => ({
        mes: String(getCell(row[0]) || '').trim(),
        total: toInt(row[1]),
      })).filter((row) => row.mes);

      const grouped = groupSessionsEvolutionByDepartment(attendantSeries, mappingRows);
      return {
        months: topGroupMonths,
        departments: grouped.departments,
        series: grouped.series,
        monthly_totals: monthlyTotals,
        source: 'dashboard_sessions_base_gold.tipo_atendimento_agent + botmaker_session.finished_by',
        rule: 'Linhas de setor = Q12B Humano; Total do mês = todas as sessões (Humano + IA)',
      };
    })();

    const [typificationsSettled, messageAgentFinishersSettled, kinshipSettled, companySessionsSettled, humanDepartmentEvolutionSettled] = await Promise.allSettled([
      typificationsPromise,
      messageAgentFinishersPromise,
      kinshipPromise,
      companySessionsPromise,
      humanDepartmentEvolutionPromise,
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
    const kinshipError = kinshipSettled.status === 'rejected'
      ? (kinshipSettled.reason instanceof Error ? kinshipSettled.reason.message : String(kinshipSettled.reason))
      : null;
    const kinshipRows = kinshipSettled.status === 'fulfilled'
      ? kinshipSettled.value.map((r) => ({
          tipo: String(getCell(r[0]) || 'Sem CPF'),
          total: toInt(r[1]),
        }))
      : [];
    const kinshipByTipo = Object.fromEntries(kinshipRows.map((row) => [row.tipo, row.total]));
    const kinshipBreakdown = {
      titular: Number(kinshipByTipo.Titular) || 0,
      dependente: Number(kinshipByTipo.Dependente) || 0,
      sem_cpf: Number(kinshipByTipo['Sem CPF']) || 0,
      total: kinshipRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
      items: [
        { tipo: 'Titular', total: Number(kinshipByTipo.Titular) || 0 },
        { tipo: 'Dependente', total: Number(kinshipByTipo.Dependente) || 0 },
        { tipo: 'Sem CPF', total: Number(kinshipByTipo['Sem CPF']) || 0 },
      ],
      error: kinshipError,
      source: 'beneficiaries.type_kinship via beneficiary_id/CPF (+ users_deleted; residual → Sem CPF)',
    };
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
    const humanDepartmentEvolutionError = humanDepartmentEvolutionSettled.status === 'rejected'
      ? (humanDepartmentEvolutionSettled.reason instanceof Error
        ? humanDepartmentEvolutionSettled.reason.message
        : String(humanDepartmentEvolutionSettled.reason))
      : null;
    const humanDepartmentEvolution = humanDepartmentEvolutionSettled.status === 'fulfilled'
      ? humanDepartmentEvolutionSettled.value
      : {
          months: topGroupMonths,
          departments: [],
          series: [],
          monthly_totals: [],
          source: 'dashboard_sessions_base_gold.tipo_atendimento_agent + botmaker_session.finished_by',
          rule: 'Linhas de setor = Q12B Humano; Total do mês = todas as sessões (Humano + IA)',
        };

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
      message_agent_kinship: kinshipBreakdown,
      typifications,
      typifications_error: typificationsError,
      typifications_finisher: typificationFinisher,
      typifications_filter_applied: { period: true, organization: true, finisher: Boolean(typificationFinisher) },
      human_department_evolution: {
        ...humanDepartmentEvolution,
        error: humanDepartmentEvolutionError,
      },
      period_filter_applied: meses.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
