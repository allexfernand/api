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
import { createSqlParams, getCell, getColumns, quoteIdent, resolveWarehouseId, runQuery, toInt, type SqlParams } from "../../../lib/databricks";
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
const QUALITY_SUMMARY_TABLE = `hive_metastore.sanus_prod.quality_analysis_silver_summary`;
const BENEFICIARIES_TABLE = `hive_metastore.sanus_prod.vw_beneficiarios`;
const BENEFICIARIES_KINSHIP_TABLE = `hive_metastore.sanus_prod.beneficiaries`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

const HUMAN_DEPT_CACHE_TTL_MS = 10 * 60 * 1000;
const humanDeptEvolutionCache = new Map<string, { at: number; payload: Record<string, unknown> }>();
const typificationSamplesCache = new Map<string, { at: number; payload: Record<string, unknown> }>();
const TYPIFICATION_SAMPLES_CACHE_TTL_MS = 5 * 60 * 1000;
const Q11D_SAMPLE_LIMIT = 7;

function soapSubjectivePreview(soap: string, max = 180): string | null {
  const text = String(soap || '').trim();
  if (!text) return null;
  const match = text.match(
    /(?:^|\n)\s*(?:Subjetivo|Subjective|\bS\b)\s*[:\-]\s*([\s\S]*?)(?=(?:\n\s*(?:Objetivo|Objective|Avalia(?:ção|cao)?|Assessment|Plano|Plan|\b[OAP]\b)\s*[:\-])|$)/i
  );
  const body = String(match?.[1] || text).replace(/\s+/g, ' ').trim();
  if (!body) return null;
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

function truncateText(value: string, max = 500): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatCpfDigits(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

type GoldDeptCapabilities = { hasFinishedBy: boolean; hasTeveUser: boolean; at: number; ttlMs: number };
let goldDeptCapabilitiesCache: GoldDeptCapabilities | null = null;

async function resolveGoldDeptCapabilities(warehouseId: string): Promise<GoldDeptCapabilities> {
  if (
    goldDeptCapabilitiesCache
    && Date.now() - goldDeptCapabilitiesCache.at < goldDeptCapabilitiesCache.ttlMs
  ) {
    return goldDeptCapabilitiesCache;
  }
  try {
    const cols = await getColumns(warehouseId, DASHBOARD_SESSIONS_TABLE, {
      force: !(goldDeptCapabilitiesCache?.hasFinishedBy && goldDeptCapabilitiesCache?.hasTeveUser),
    });
    const lower = new Set(cols.map((column) => column.toLowerCase()));
    const hasFinishedBy = lower.has("finished_by");
    const hasTeveUser = lower.has("teve_user");
    goldDeptCapabilitiesCache = {
      hasFinishedBy,
      hasTeveUser,
      at: Date.now(),
      // Re-probe rápido enquanto a gold ainda não tem as colunas novas.
      ttlMs: hasFinishedBy && hasTeveUser ? 5 * 60 * 1000 : 30 * 1000,
    };
  } catch {
    goldDeptCapabilitiesCache = {
      hasFinishedBy: false,
      hasTeveUser: false,
      at: Date.now(),
      ttlMs: 30 * 1000,
    };
  }
  return goldDeptCapabilitiesCache;
}

function monthRangeBounds(months: string[]) {
  const sorted = [...months].filter((month) => /^\d{4}-\d{2}$/.test(month)).sort();
  if (!sorted.length) {
    const fallback = lastNMonthsList(12);
    return monthRangeBounds(fallback);
  }
  const start = `${sorted[0]}-01`;
  const [yearRaw, monthRaw] = sorted[sorted.length - 1].split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const endExclusive = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, endExclusive, months: sorted };
}

function normalizeCpfSql(expr: string) {
  return `NULLIF(LPAD(REGEXP_REPLACE(CAST(${expr} AS STRING), '[^0-9]', ''), 11, '0'), '00000000000')`;
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

  const mesesRaw = req.query.meses;
  const meses = (Array.isArray(mesesRaw) ? mesesRaw.join(",") : String(mesesRaw || ""))
    .split(",")
    .map((m: string) => String(m || "").trim())
    .filter((m: string) => /^\d{4}-\d{2}$/.test(m));
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
  const sampleSessionId = req.query.session_id ? String(req.query.session_id).trim() : '';
  const includeUserInteraction = String(req.query.include_user_interaction || '') === '1';

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
    const userInteractionExistsSql = `
      EXISTS (
        SELECT 1
        FROM ${MESSAGE_TABLE} m
        WHERE CAST(m.${quoteIdent('session_id')} AS STRING) = CAST(s.${quoteIdent('session_id')} AS STRING)
          AND LOWER(TRIM(CAST(m.${quoteIdent('sender_type')} AS STRING))) = 'user'
      )
    `;
    const withUserInteractionFilter = (baseWhere: string | null | undefined) => {
      if (!includeUserInteraction) return baseWhere || '';
      return baseWhere ? `${baseWhere} AND ${userInteractionExistsSql}` : userInteractionExistsSql;
    };
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

    if (scope === 'kinship') {
      // Sempre aplica filtros de período + parceiro/grupo quando presentes (Visão Parceiros e Sessões).
      const kinshipWhere = [companySessionsDateFilter, companySessionsScopeFilter].filter(Boolean).join(' AND ');
      try {
        const rows = await runQuery(warehouseId, `
          WITH scoped AS (
            SELECT
              CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id,
              CAST(s.${quoteIdent('beneficiary_key')} AS STRING) AS beneficiary_key
            FROM ${dashboardSessionsTable} s
            ${kinshipWhere ? `WHERE ${kinshipWhere}` : ''}
          ),
          with_identity AS (
            SELECT
              session_id,
              CASE
                WHEN beneficiary_key LIKE 'beneficiary:%'
                THEN NULLIF(TRIM(SUBSTRING(beneficiary_key, 13)), '')
                ELSE NULL
              END AS beneficiary_id,
              CASE
                WHEN beneficiary_key LIKE 'cpf:%'
                THEN ${normalizeCpfSql('SUBSTRING(beneficiary_key, 5)')}
                ELSE NULL
              END AS cpf_norm
            FROM scoped
          ),
          scoped_ids AS (
            SELECT DISTINCT beneficiary_id
            FROM with_identity
            WHERE beneficiary_id IS NOT NULL
          ),
          scoped_cpfs AS (
            SELECT DISTINCT cpf_norm
            FROM with_identity
            WHERE cpf_norm IS NOT NULL
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
              INNER JOIN scoped_ids i ON CAST(b.${quoteIdent('id')} AS STRING) = i.beneficiary_id
              UNION ALL
              SELECT CAST(b.${quoteIdent('beneficiary_id')} AS STRING) AS key_id, b.type_kinship
              FROM ${BENEFICIARIES_KINSHIP_TABLE} b
              INNER JOIN scoped_ids i ON CAST(b.${quoteIdent('beneficiary_id')} AS STRING) = i.beneficiary_id
              UNION ALL
              SELECT CAST(b.${quoteIdent('user_id')} AS STRING) AS key_id, b.type_kinship
              FROM ${BENEFICIARIES_KINSHIP_TABLE} b
              INNER JOIN scoped_ids i ON CAST(b.${quoteIdent('user_id')} AS STRING) = i.beneficiary_id
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
            INNER JOIN scoped_cpfs c
              ON ${normalizeCpfSql('b.cpf')} = c.cpf_norm
            WHERE b.cpf IS NOT NULL
              AND TRIM(CAST(b.cpf AS STRING)) != ''
            GROUP BY ${normalizeCpfSql('b.cpf')}
          ),
          classified AS (
            SELECT
              CASE
                WHEN COALESCE(bi.tipo, bt.tipo) IN ('Titular', 'Dependente') THEN COALESCE(bi.tipo, bt.tipo)
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
          )
          SELECT classe, COUNT(*) AS total_sessions
          FROM classified
          GROUP BY classe
          ORDER BY total_sessions DESC
        `, params.list);
        const kinshipRows = rows.map((r) => ({
          tipo: String(getCell(r[0]) || 'Sem CPF'),
          total: toInt(r[1]),
        }));
        const byTipo = Object.fromEntries(kinshipRows.map((row) => [row.tipo, row.total]));
        setStableCache(res);
        return res.status(200).json({
          scope: 'kinship',
          titular: Number(byTipo.Titular) || 0,
          dependente: Number(byTipo.Dependente) || 0,
          sem_cpf: Number(byTipo['Sem CPF']) || 0,
          total: kinshipRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
          items: [
            { tipo: 'Titular', total: Number(byTipo.Titular) || 0 },
            { tipo: 'Dependente', total: Number(byTipo.Dependente) || 0 },
            { tipo: 'Sem CPF', total: Number(byTipo['Sem CPF']) || 0 },
          ],
          source: 'beneficiaries.type_kinship via beneficiary_id/CPF (residual → Sem CPF)',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(200).json({
          scope: 'kinship',
          titular: 0,
          dependente: 0,
          sem_cpf: 0,
          total: 0,
          items: [],
          error: msg,
        });
      }
    }

    if (scope === 'human_interaction') {
      // Idêntico ao Q12B (message_agent_finishers do endpoint principal).
      const where = companySessionsMode === "company"
        ? companySessionsWhere
        : (companySessionsDateFilter || '');
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
          tipo: String(getCell(row[0]) || '—'),
          total: toInt(row[1]),
        })),
        filters_applied: {
          period: meses.length > 0,
          organization: Boolean(groupNames.length || company || partnerBrokerId),
        },
        source: "dashboard_sessions_base_gold.tipo_atendimento_agent",
        rule: "Q12B = tipo_atendimento_agent (teve mensagem agent)",
      });
    }

    if (scope === 'human_by_department') {
      const { groupSessionsByDepartment, listAttendantMappings } = await import("../attendants/service");
      // Q15B: segue 100% os filtros (incluindo data). Sem meses = sem filtro de período.
      const monthList = meses.length > 0 ? meses : [];
      const monthInList = monthList.map((m) => `'${m}'`).join(',');
      const dateFilter = monthList.length > 0 ? `s.${quoteIdent('mes')} IN (${monthInList})` : null;
      const baseWhere = [
        dateFilter,
        companySessionsScopeFilter,
      ].filter(Boolean).join(' AND ');
      const queryParams = params.list.length ? params.list : undefined;
      const caps = await resolveGoldDeptCapabilities(warehouseId);
      const boundsMonths = monthList.length > 0 ? monthList : lastNMonthsList(24);
      const { start, endExclusive } = monthRangeBounds(boundsMonths);
      const sessionMonthPrune = monthList.length > 0
        ? `AND DATE_FORMAT(try_cast(b.${quoteIdent('creation_time')} AS TIMESTAMP), 'yyyy-MM') IN (${monthInList})`
        : '';

      try {
        const useGoldFastPath = caps.hasFinishedBy && (!includeUserInteraction || caps.hasTeveUser);
        const [mappingRows, attendantRows] = await Promise.all([
          listAttendantMappings(),
          useGoldFastPath
            ? runQuery(warehouseId, `
                SELECT
                  COALESCE(
                    NULLIF(TRIM(CAST(s.${quoteIdent('finished_by')} AS STRING)), ''),
                    '(Sem finished_by)'
                  ) AS attendant,
                  COUNT(*) AS total_sessions
                FROM ${dashboardSessionsTable} s
                WHERE s.${quoteIdent('tipo_atendimento_agent')} = 'Humano'
                  ${baseWhere ? `AND ${baseWhere}` : ''}
                  ${includeUserInteraction ? `AND COALESCE(s.${quoteIdent('teve_user')}, 0) = 1` : ''}
                GROUP BY 1
                ORDER BY total_sessions DESC
                LIMIT 2000
              `, queryParams)
            : runQuery(warehouseId, `
                WITH scoped AS (
                  SELECT CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id
                  FROM ${dashboardSessionsTable} s
                  WHERE s.${quoteIdent('tipo_atendimento_agent')} = 'Humano'
                    ${baseWhere ? `AND ${baseWhere}` : ''}
                ),
                user_hits AS (
                  SELECT DISTINCT CAST(m.${quoteIdent('session_id')} AS STRING) AS session_id
                  FROM ${MESSAGE_TABLE} m
                  WHERE LOWER(TRIM(CAST(m.${quoteIdent('sender_type')} AS STRING))) = 'user'
                    AND try_cast(m.${quoteIdent('creation_time')} AS TIMESTAMP) >= TIMESTAMP '${start}'
                    AND try_cast(m.${quoteIdent('creation_time')} AS TIMESTAMP) < TIMESTAMP '${endExclusive}'
                ),
                scoped_user AS (
                  SELECT sc.session_id
                  FROM scoped sc
                  ${includeUserInteraction ? 'INNER JOIN user_hits uh ON uh.session_id = sc.session_id' : ''}
                )
                SELECT
                  COALESCE(
                    NULLIF(TRIM(CAST(b.${quoteIdent('finished_by')} AS STRING)), ''),
                    '(Sem finished_by)'
                  ) AS attendant,
                  COUNT(*) AS total_sessions
                FROM scoped_user su
                LEFT JOIN ${SESSION_TABLE} b
                  ON CAST(b.${quoteIdent('session_id')} AS STRING) = su.session_id
                 ${sessionMonthPrune}
                GROUP BY 1
                ORDER BY total_sessions DESC
                LIMIT 2000
              `, queryParams),
        ]);

        const attendants = attendantRows.map((row) => ({
          attendant: String(getCell(row[0]) || '').trim() || '(Sem finished_by)',
          total: toInt(row[1]),
        })).filter((row) => row.attendant);

        const grouped = groupSessionsByDepartment(attendants, mappingRows);
        setStableCache(res);
        return res.status(200).json({
          scope: 'human_by_department',
          months: monthList,
          ...grouped,
          attendants: attendants.slice(0, 50),
          filters_applied: {
            period: monthList.length > 0,
            organization: Boolean(groupNames.length || company || partnerBrokerId),
            user_interaction: includeUserInteraction,
          },
          source: useGoldFastPath
            ? 'dashboard_sessions_base_gold.finished_by + teve_user'
            : 'dashboard_sessions_base_gold.tipo_atendimento_agent + botmaker_session.finished_by',
          rule: includeUserInteraction
            ? 'Universo = Q12B Humano com ≥1 interação do cliente (sender_type=user); departamento via finished_by'
            : 'Universo = Q12B Humano (tipo_atendimento_agent); departamento via finished_by',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(200).json({
          scope: 'human_by_department',
          months: monthList,
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
      const where = withUserInteractionFilter(
        [companySessionsDateFilter, companySessionsScopeFilter, typificationFinisherFilter, tipFilter]
          .filter(Boolean)
          .join(' AND '),
      );
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
            user_interaction: includeUserInteraction,
          },
          finisher: typificationFinisher || null,
          source: 'dashboard_sessions_base_gold.economic_group_canonical',
          rule: includeUserInteraction
            ? 'Q11B = tipificação + grupo · só sessões com ≥1 mensagem sender_type=user'
            : 'Q11B = tipificação + grupo',
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

    // Q11D modal: mensagens sob demanda (não bloqueia o carregamento da lista).
    if (scope === 'typification_sample_messages') {
      if (!sampleSessionId) {
        return res.status(200).json({
          scope: 'typification_sample_messages',
          session_id: null,
          messages: [],
          error: 'session_id é obrigatório',
        });
      }
      try {
        const msgParams = createSqlParams();
        const sidParam = msgParams.add(sampleSessionId);
        const msgRows = await runQuery(warehouseId, `
          SELECT
            DATE_FORMAT(try_cast(m.${quoteIdent('creation_time')} AS TIMESTAMP), 'HH:mm') AS msg_at,
            LOWER(TRIM(CAST(m.${quoteIdent('sender_type')} AS STRING))) AS sender_type,
            TRIM(CAST(m.${quoteIdent('content_text')} AS STRING)) AS content_text
          FROM ${MESSAGE_TABLE} m
          WHERE CAST(m.${quoteIdent('session_id')} AS STRING) = ${sidParam}
            AND m.${quoteIdent('content_text')} IS NOT NULL
            AND TRIM(CAST(m.${quoteIdent('content_text')} AS STRING)) <> ''
          ORDER BY try_cast(m.${quoteIdent('creation_time')} AS TIMESTAMP)
          LIMIT 16
        `, msgParams.list);
        const messages = msgRows.map((row) => ({
          at: String(getCell(row[0]) || ''),
          sender: String(getCell(row[1]) || 'unknown'),
          text: truncateText(String(getCell(row[2]) || ''), 420),
        })).filter((m) => m.text);
        setStableCache(res);
        return res.status(200).json({
          scope: 'typification_sample_messages',
          session_id: sampleSessionId,
          messages,
          total: messages.length,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(200).json({
          scope: 'typification_sample_messages',
          session_id: sampleSessionId,
          messages: [],
          total: 0,
          error: msg,
        });
      }
    }

    // Q11C / Q11D (Sessões - New): tipificação de quality_analysis_silver_summary
    // Join: qa.id = gold.session_id · filtros/interação via gold.
    if (scope === 'typification_live' || scope === 'typification_groups_live' || scope === 'typification_samples_live') {
      const wantsSamples = scope === 'typification_groups_live' || scope === 'typification_samples_live';
      if (wantsSamples && !typificationValue) {
        return res.status(200).json({
          scope: 'typification_samples_live',
          typification: null,
          conversations: [],
          total: 0,
          error: 'typification_value é obrigatório',
        });
      }
      const qaTipExpr = `CASE
        WHEN q.${quoteIdent('tipificacao')} IS NULL THEN '(NULO)'
        WHEN TRIM(CAST(q.${quoteIdent('tipificacao')} AS STRING)) = '' THEN '(VAZIO/BRANCO)'
        ELSE TRIM(CAST(q.${quoteIdent('tipificacao')} AS STRING))
      END`;
      const baseWhere = [
        companySessionsDateFilter,
        companySessionsScopeFilter,
        `COALESCE(s.${quoteIdent('teve_user')}, 0) = 1`,
      ].filter(Boolean).join(' AND ');
      const tipValueFilter = wantsSamples && typificationValue
        ? `${qaTipExpr} = ${params.add(typificationValue)}`
        : null;
      const where = [baseWhere, tipValueFilter].filter(Boolean).join(' AND ');
      const queryParams = params.list.length ? params.list : undefined;

      try {
        if (!wantsSamples) {
          const rows = await runQuery(warehouseId, `
            SELECT
              ${qaTipExpr} AS tipificacao,
              COUNT(*) AS total_sessions
            FROM ${dashboardSessionsTable} s
            INNER JOIN ${QUALITY_SUMMARY_TABLE} q
              ON CAST(q.${quoteIdent('id')} AS STRING) = CAST(s.${quoteIdent('session_id')} AS STRING)
            ${where ? `WHERE ${where}` : ''}
            GROUP BY 1
            ORDER BY total_sessions DESC
            LIMIT 40
          `, queryParams);
          const typifications = rows.map((r) => ({
            tipo: String(getCell(r[0]) || '—'),
            total: toInt(r[1]),
          }));
          setStableCache(res);
          return res.status(200).json({
            scope: 'typification_live',
            typifications,
            total: typifications.reduce((acc, item) => acc + item.total, 0),
            filters_applied: {
              period: meses.length > 0,
              organization: Boolean(groupNames.length || company || partnerBrokerId),
              user_interaction: true,
            },
            source: 'quality_analysis_silver_summary.tipificacao · join qa.id = gold.session_id',
            rule: 'Q11C = tipificação QA summary · gold c/ interação · filtros da página',
            coverage_note: 'QA a partir de 2026-01; cobertura ~90%+ das sessões gold c/ interação nesse período',
          });
        }

        const samplesCacheKey = JSON.stringify({
          scope: 'typification_samples_live',
          v: 3,
          tip: typificationValue,
          months: meses,
          groups: groupNames,
          company,
          partnerBrokerId,
        });
        const samplesCached = typificationSamplesCache.get(samplesCacheKey);
        if (samplesCached && Date.now() - samplesCached.at < TYPIFICATION_SAMPLES_CACHE_TTL_MS) {
          setStableCache(res);
          return res.status(200).json(samplesCached.payload);
        }

        const patientNameExpr = `NULLIF(TRIM(CAST(COALESCE(
          b.${quoteIdent('variables')}['nameHolder'],
          b.${quoteIdent('variables')}['nomeTitular'],
          b.${quoteIdent('variables')}['dependentName1'],
          b.${quoteIdent('variables')}['fromName']
        ) AS STRING)), '')`;
        const patientCpfExpr = `NULLIF(REGEXP_REPLACE(CAST(COALESCE(
          b.${quoteIdent('variables')}['cpfHolder'],
          b.${quoteIdent('variables')}['inputCpfHolder'],
          b.${quoteIdent('variables')}['cpfTitular'],
          b.${quoteIdent('variables')}['dependentCpf1'],
          b.${quoteIdent('variables')}['cpf'],
          b.${quoteIdent('variables')}['CPF'],
          b.${quoteIdent('variables')}['cpf_beneficiario'],
          b.${quoteIdent('variables')}['beneficiary_cpf']
        ) AS STRING), '[^0-9]', ''), '')`;
        const sampleSelect = `
          CAST(q.${quoteIdent('id')} AS STRING) AS qa_id,
          CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id,
          ${qaTipExpr} AS tipificacao,
          DATE_FORMAT(try_cast(q.${quoteIdent('event_timestamp')} AS TIMESTAMP), 'yyyy-MM-dd HH:mm') AS event_at,
          NULLIF(TRIM(CAST(q.${quoteIdent('closed_by')} AS STRING)), '') AS closed_by,
          NULLIF(TRIM(CAST(q.${quoteIdent('linha_de_cuidado')} AS STRING)), '') AS linha_de_cuidado,
          NULLIF(TRIM(CAST(q.${quoteIdent('categoria_linha_de_cuidado')} AS STRING)), '') AS categoria_linha_de_cuidado,
          NULLIF(TRIM(CAST(q.${quoteIdent('status_demanda')} AS STRING)), '') AS status_demanda,
          LOWER(TRIM(CAST(q.${quoteIdent('problema_resolvido')} AS STRING))) AS problema_resolvido,
          try_cast(q.${quoteIdent('percentual_desempenho')} AS DOUBLE) AS percentual_desempenho,
          try_cast(q.${quoteIdent('nota_atendimento')} AS DOUBLE) AS nota_atendimento,
          try_cast(q.${quoteIdent('nota_maxima_possivel')} AS DOUBLE) AS nota_maxima_possivel,
          NULLIF(TRIM(CAST(q.${quoteIdent('tipo_atendimento_agendamento')} AS STRING)), '') AS tipo_atendimento_agendamento,
          CAST(q.${quoteIdent('has_bot')} AS STRING) AS has_bot,
          CAST(q.${quoteIdent('has_agent')} AS STRING) AS has_agent,
          NULLIF(TRIM(CAST(s.${quoteIdent('economic_group_canonical')} AS STRING)), '') AS economic_group,
          NULLIF(TRIM(CAST(s.${quoteIdent('organization_name')} AS STRING)), '') AS organization_name,
          NULLIF(TRIM(b.${quoteIdent('resume_soap')}), '') AS resume_soap,
          NULLIF(TRIM(CAST(b.${quoteIdent('motivo')} AS STRING)), '') AS motivo,
          ${patientNameExpr} AS patient_name,
          ${patientCpfExpr} AS patient_cpf
        `;

        // 1) SOAP primeiro (mais útil + evita ordenar o universo inteiro por has_soap).
        // 2) Completa com as mais recentes se faltar.
        const soapRows = await runQuery(warehouseId, `
          SELECT ${sampleSelect}
          FROM ${dashboardSessionsTable} s
          INNER JOIN ${QUALITY_SUMMARY_TABLE} q
            ON CAST(q.${quoteIdent('id')} AS STRING) = CAST(s.${quoteIdent('session_id')} AS STRING)
          INNER JOIN ${SESSION_TABLE} b
            ON CAST(b.${quoteIdent('session_id')} AS STRING) = CAST(s.${quoteIdent('session_id')} AS STRING)
           AND NULLIF(TRIM(b.${quoteIdent('resume_soap')}), '') IS NOT NULL
          WHERE ${where || '1=1'}
          ORDER BY try_cast(q.${quoteIdent('event_timestamp')} AS TIMESTAMP) DESC
          LIMIT ${Q11D_SAMPLE_LIMIT}
        `, queryParams);

        let rows = soapRows;
        if (rows.length < Q11D_SAMPLE_LIMIT) {
          const excludeIds = rows
            .map((r) => String(getCell(r[1]) || '').trim())
            .filter(Boolean);
          const notInFilter = excludeIds.length
            ? `CAST(s.${quoteIdent('session_id')} AS STRING) NOT IN (${excludeIds.map((id) => params.add(id)).join(', ')})`
            : null;
          const fillWhere = [where, notInFilter].filter(Boolean).join(' AND ');
          const fillRows = await runQuery(warehouseId, `
            SELECT ${sampleSelect}
            FROM ${dashboardSessionsTable} s
            INNER JOIN ${QUALITY_SUMMARY_TABLE} q
              ON CAST(q.${quoteIdent('id')} AS STRING) = CAST(s.${quoteIdent('session_id')} AS STRING)
            LEFT JOIN ${SESSION_TABLE} b
              ON CAST(b.${quoteIdent('session_id')} AS STRING) = CAST(s.${quoteIdent('session_id')} AS STRING)
            WHERE ${fillWhere || '1=1'}
            ORDER BY try_cast(q.${quoteIdent('event_timestamp')} AS TIMESTAMP) DESC
            LIMIT ${Q11D_SAMPLE_LIMIT - rows.length}
          `, params.list.length ? params.list : undefined);
          rows = [...rows, ...fillRows];
        }

        const conversations = rows.map((r) => {
          const soap = String(getCell(r[17]) || '').trim();
          const motivo = String(getCell(r[18]) || '').trim();
          const patientName = String(getCell(r[19]) || '').trim();
          const patientCpf = formatCpfDigits(String(getCell(r[20]) || ''));
          const preview = soapSubjectivePreview(soap)
            || (motivo ? `Motivo: ${motivo}` : null)
            || String(getCell(r[5]) || '').trim()
            || null;
          const pctRaw = getCell(r[9]);
          const notaRaw = getCell(r[10]);
          const notaMaxRaw = getCell(r[11]);
          return {
            qa_id: String(getCell(r[0]) || ''),
            session_id: String(getCell(r[1]) || ''),
            tipificacao: String(getCell(r[2]) || '—'),
            event_at: String(getCell(r[3]) || ''),
            closed_by: String(getCell(r[4]) || '') || null,
            linha_de_cuidado: String(getCell(r[5]) || '') || null,
            categoria_linha_de_cuidado: String(getCell(r[6]) || '') || null,
            status_demanda: String(getCell(r[7]) || '') || null,
            problema_resolvido: String(getCell(r[8]) || '') || null,
            percentual_desempenho: Number.isFinite(Number(pctRaw)) ? Number(pctRaw) : null,
            nota_atendimento: Number.isFinite(Number(notaRaw)) ? Number(notaRaw) : null,
            nota_maxima_possivel: Number.isFinite(Number(notaMaxRaw)) ? Number(notaMaxRaw) : null,
            tipo_atendimento_agendamento: String(getCell(r[12]) || '') || null,
            has_bot: String(getCell(r[13]) || '').toLowerCase() === 'true',
            has_agent: String(getCell(r[14]) || '').toLowerCase() === 'true',
            economic_group: String(getCell(r[15]) || '') || null,
            organization_name: String(getCell(r[16]) || '') || null,
            soap: soap || null,
            motivo: motivo || null,
            patient_name: patientName || null,
            patient_cpf: patientCpf,
            has_soap: Boolean(soap),
            preview: preview || null,
            messages: [] as Array<{ at: string; sender: string; text: string }>,
            messages_loaded: false,
          };
        });

        const payload = {
          scope: 'typification_samples_live',
          typification: typificationValue,
          conversations,
          total: conversations.length,
          filters_applied: {
            period: meses.length > 0,
            organization: Boolean(groupNames.length || company || partnerBrokerId),
            user_interaction: true,
          },
          source: 'botmaker_session.resume_soap · mensagens sob demanda no popup',
          rule: `Q11D = ${Q11D_SAMPLE_LIMIT} conversas do motivo QA (prioriza SOAP) · scroll no quadro · msgs no clique`,
        };
        typificationSamplesCache.set(samplesCacheKey, { at: Date.now(), payload });
        setStableCache(res);
        return res.status(200).json(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!wantsSamples) {
          return res.status(200).json({
            scope: 'typification_live',
            typifications: [],
            total: 0,
            error: msg,
          });
        }
        return res.status(200).json({
          scope: 'typification_samples_live',
          typification: typificationValue,
          conversations: [],
          total: 0,
          error: msg,
        });
      }
    }

    // Q15: janela fixa dos últimos 12 meses (igual Q3). Preferir colunas gold (finished_by/teve_user).
    if (scope === 'human_department_evolution') {
      const topGroupMonths = lastNMonthsList(12);
      const monthInList = topGroupMonths.map((m) => `'${m}'`).join(',');
      const topGroupDateFilter = `s.${quoteIdent('mes')} IN (${monthInList})`;
      const baseWhere = [
        topGroupDateFilter,
        companySessionsScopeFilter,
      ].filter(Boolean).join(' AND ');
      const queryParams = params.list.length ? params.list : undefined;
      const cacheKey = JSON.stringify({
        scope: 'human_department_evolution',
        months: topGroupMonths,
        groups: groupNames,
        company,
        partnerBrokerId,
        user: includeUserInteraction ? 1 : 0,
      });
      const cached = humanDeptEvolutionCache.get(cacheKey);
      if (cached && Date.now() - cached.at < HUMAN_DEPT_CACHE_TTL_MS) {
        setStableCache(res);
        return res.status(200).json(cached.payload);
      }
      try {
        const { groupSessionsEvolutionByDepartment, groupSessionsByDepartment, listAttendantMappings } = await import("../attendants/service");
        const caps = await resolveGoldDeptCapabilities(warehouseId);
        const useGoldFastPath = caps.hasFinishedBy && (!includeUserInteraction || caps.hasTeveUser);
        const { start, endExclusive } = monthRangeBounds(topGroupMonths);
        const [mappingRows, attendantRows] = await Promise.all([
          listAttendantMappings(),
          useGoldFastPath
            ? runQuery(warehouseId, `
                SELECT
                  s.${quoteIdent('mes')} AS mes,
                  COALESCE(
                    NULLIF(TRIM(CAST(s.${quoteIdent('finished_by')} AS STRING)), ''),
                    '(Sem finished_by)'
                  ) AS attendant,
                  COUNT(*) AS total_sessions
                FROM ${dashboardSessionsTable} s
                WHERE s.${quoteIdent('tipo_atendimento_agent')} = 'Humano'
                  AND ${baseWhere}
                  ${includeUserInteraction ? `AND COALESCE(s.${quoteIdent('teve_user')}, 0) = 1` : ''}
                GROUP BY s.${quoteIdent('mes')}, 2
                ORDER BY s.${quoteIdent('mes')}, total_sessions DESC
              `, queryParams)
            : runQuery(warehouseId, `
                WITH scoped AS (
                  SELECT
                    CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id,
                    s.${quoteIdent('mes')} AS mes
                  FROM ${dashboardSessionsTable} s
                  WHERE s.${quoteIdent('tipo_atendimento_agent')} = 'Humano'
                    AND ${baseWhere}
                ),
                user_hits AS (
                  SELECT DISTINCT CAST(m.${quoteIdent('session_id')} AS STRING) AS session_id
                  FROM ${MESSAGE_TABLE} m
                  WHERE LOWER(TRIM(CAST(m.${quoteIdent('sender_type')} AS STRING))) = 'user'
                    AND try_cast(m.${quoteIdent('creation_time')} AS TIMESTAMP) >= TIMESTAMP '${start}'
                    AND try_cast(m.${quoteIdent('creation_time')} AS TIMESTAMP) < TIMESTAMP '${endExclusive}'
                ),
                scoped_user AS (
                  SELECT sc.session_id, sc.mes
                  FROM scoped sc
                  ${includeUserInteraction ? 'INNER JOIN user_hits uh ON uh.session_id = sc.session_id' : ''}
                )
                SELECT
                  su.mes AS mes,
                  COALESCE(
                    NULLIF(TRIM(CAST(b.${quoteIdent('finished_by')} AS STRING)), ''),
                    '(Sem finished_by)'
                  ) AS attendant,
                  COUNT(*) AS total_sessions
                FROM scoped_user su
                LEFT JOIN ${SESSION_TABLE} b
                  ON CAST(b.${quoteIdent('session_id')} AS STRING) = su.session_id
                 AND DATE_FORMAT(try_cast(b.${quoteIdent('creation_time')} AS TIMESTAMP), 'yyyy-MM') IN (${monthInList})
                GROUP BY su.mes, 2
                ORDER BY su.mes, total_sessions DESC
              `, queryParams),
        ]);

        const attendantSeries = attendantRows.map((row) => ({
          mes: String(getCell(row[0]) || '').trim(),
          attendant: String(getCell(row[1]) || '').trim() || '(Sem finished_by)',
          total: toInt(row[2]),
        })).filter((row) => row.mes && row.attendant);

        const grouped = groupSessionsEvolutionByDepartment(attendantSeries, mappingRows);
        const attendantsByName = new Map<string, number>();
        attendantSeries.forEach((row) => {
          attendantsByName.set(row.attendant, (attendantsByName.get(row.attendant) || 0) + row.total);
        });
        const departmentSummary = groupSessionsByDepartment(
          [...attendantsByName.entries()].map(([attendant, total]) => ({ attendant, total })),
          mappingRows,
        );
        const payload = {
          scope: 'human_department_evolution',
          months: topGroupMonths,
          departments: grouped.departments,
          series: grouped.series,
          monthly_totals: [] as Array<{ mes: string; total: number }>,
          departments_summary: departmentSummary,
          filters_applied: {
            period: false,
            organization: Boolean(groupNames.length || company || partnerBrokerId),
            user_interaction: includeUserInteraction,
          },
          source: useGoldFastPath
            ? 'dashboard_sessions_base_gold.finished_by + teve_user'
            : 'dashboard_sessions_base_gold.tipo_atendimento_agent + botmaker_session.finished_by',
          rule: includeUserInteraction
            ? 'Linhas de setor = Q12B Humano c/ ≥1 interação do cliente; Total do mês = série Q4B (sessões c/ interação)'
            : 'Linhas de setor = Q12B Humano; Total do mês = série Q4B',
        };
        humanDeptEvolutionCache.set(cacheKey, { at: Date.now(), payload });
        setStableCache(res);
        return res.status(200).json(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(200).json({
          scope: 'human_department_evolution',
          months: topGroupMonths,
          departments: [],
          series: [],
          monthly_totals: [],
          departments_summary: { departments: [], total: 0 },
          error: msg,
        });
      }
    }

    const messageAgentFinishersWhere = withUserInteractionFilter(
      companySessionsMode === "company" ? companySessionsWhere : (companySessionsDateFilter || ''),
    );
    const messageAgentFinishersPromise = runQuery(warehouseId, `
      SELECT
        s.${quoteIdent('tipo_atendimento_agent')} AS tipo_atendimento,
        COUNT(*) AS total_sessions
      FROM ${dashboardSessionsTable} s
      ${messageAgentFinishersWhere ? `WHERE ${messageAgentFinishersWhere}` : ''}
      GROUP BY s.${quoteIdent('tipo_atendimento_agent')}
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

    const companySessionsForUiWhere = withUserInteractionFilter(
      companySessionsMode === "company" ? companySessionsWhere : (companySessionsDateFilter || ''),
    );
    const companySessionsForUiPromise = includeUserInteraction
      ? (companySessionsMode === "company"
        ? runQuery(warehouseId, `
          SELECT
            COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent('organization_name')} AS STRING)), ''), 'Sem empresa') AS empresa,
            COUNT(*) AS total_sessions
          FROM ${dashboardSessionsTable} s
          ${companySessionsForUiWhere ? `WHERE ${companySessionsForUiWhere}` : ''}
          GROUP BY COALESCE(NULLIF(TRIM(CAST(s.${quoteIdent('organization_name')} AS STRING)), ''), 'Sem empresa')
          ORDER BY total_sessions DESC
        `, params.list)
        : runQuery(warehouseId, `
          SELECT
            s.${quoteIdent('economic_group_canonical')} AS empresa,
            COUNT(*) AS total_sessions
          FROM ${dashboardSessionsTable} s
          ${companySessionsForUiWhere ? `WHERE ${companySessionsForUiWhere}` : ''}
          GROUP BY s.${quoteIdent('economic_group_canonical')}
          ORDER BY total_sessions DESC
        `))
      : Promise.resolve(null);

    const userInteractionWhere = companySessionsMode === "company"
      ? companySessionsWhere
      : (companySessionsDateFilter || '');
    const userInteractionPromise = includeUserInteraction
      ? runQuery(warehouseId, `
        SELECT COUNT(*) AS total_sessions
        FROM ${dashboardSessionsTable} s
        ${userInteractionWhere ? `WHERE ${userInteractionWhere}` : ''}
          ${userInteractionWhere ? 'AND' : 'WHERE'} ${userInteractionExistsSql}
      `, companySessionsMode === "company" ? params.list : undefined)
      : Promise.resolve(null);

    const typificationsWhere = withUserInteractionFilter(
      companySessionsMode === "company"
        ? [companySessionsWhere, typificationFinisherFilter].filter(Boolean).join(' AND ')
        : [companySessionsDateFilter, typificationFinisherFilter].filter(Boolean).join(' AND '),
    );
    const typificationsPromise = runQuery(warehouseId, `
      SELECT
        s.${quoteIdent('tipificacao')} AS tipificacao,
        COUNT(*) AS total_sessions
      FROM ${dashboardSessionsTable} s
      ${typificationsWhere ? `WHERE ${typificationsWhere}` : ''}
      GROUP BY s.${quoteIdent('tipificacao')}
      ORDER BY total_sessions DESC
      LIMIT 30
    `, companySessionsMode === "company" || includeUserInteraction ? params.list : (
      typificationFinisherFilter ? params.list : undefined
    ));

    const [typificationsSettled, messageAgentFinishersSettled, companySessionsSettled, companySessionsForUiSettled, userInteractionSettled] = await Promise.allSettled([
      typificationsPromise,
      messageAgentFinishersPromise,
      companySessionsPromise,
      companySessionsForUiPromise,
      userInteractionPromise,
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
    const companySessionsUnfiltered = companySessionsSettled.status === 'fulfilled'
      ? companySessionsSettled.value.map((r) => ({
          empresa: String(getCell(r[0]) || "Sem empresa"),
          total: toInt(r[1]),
        }))
      : [];
    const companySessionsForUiError = includeUserInteraction
      ? (companySessionsForUiSettled.status === 'rejected'
        ? (companySessionsForUiSettled.reason instanceof Error ? companySessionsForUiSettled.reason.message : String(companySessionsForUiSettled.reason))
        : null)
      : null;
    const companySessions = includeUserInteraction
      ? (companySessionsForUiSettled.status === 'fulfilled' && Array.isArray(companySessionsForUiSettled.value)
        ? companySessionsForUiSettled.value.map((r) => ({
            empresa: String(getCell(r[0]) || "Sem empresa"),
            total: toInt(r[1]),
          }))
        : [])
      : companySessionsUnfiltered;
    const companySessionsTotal = companySessionsUnfiltered.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
    const economicGroupTotal = companySessionsSettled.status === 'fulfilled' ? companySessionsTotal : 0;
    const economicGroupTotalError = companySessionsError;
    const companySessionsUiError = includeUserInteraction ? (companySessionsForUiError || null) : companySessionsError;
    const userInteractionError = !includeUserInteraction
      ? null
      : (userInteractionSettled.status === 'rejected'
        ? (userInteractionSettled.reason instanceof Error ? userInteractionSettled.reason.message : String(userInteractionSettled.reason))
        : null);
    const userInteractionTotal = includeUserInteraction && userInteractionSettled.status === 'fulfilled' && Array.isArray(userInteractionSettled.value)
      ? toInt(userInteractionSettled.value?.[0]?.[0])
      : null;

    setStableCache(res);
    res.status(200).json({
      economic_group_total: economicGroupTotal,
      economic_group_total_error: economicGroupTotalError,
      economic_group_with_user_interaction_total: userInteractionTotal,
      economic_group_with_user_interaction_error: userInteractionError,
      user_interaction_included: includeUserInteraction,
      user_interaction_rule: includeUserInteraction
        ? "Sessão com ≥1 mensagem em botmaker_message onde sender_type = 'user'"
        : null,
      company_sessions: companySessions,
      company_sessions_error: companySessionsUiError,
      company_sessions_mode: companySessionsMode,
      company_sessions_source: includeUserInteraction
        ? `${companySessionsSource} · só sessões com ≥1 interação do cliente`
        : companySessionsSource,
      message_agent_finishers: messageAgentFinishers,
      message_agent_finishers_error: messageAgentFinishersError,
      message_agent_finishers_filter_applied: {
        period: true,
        organization: true,
        user_interaction: includeUserInteraction,
      },
      message_agent_finishers_rule: includeUserInteraction
        ? "Q12B = tipo_atendimento_agent, só sessões com ≥1 mensagem sender_type=user"
        : "Q12B = tipo_atendimento_agent (teve mensagem agent)",
      typifications,
      typifications_error: typificationsError,
      typifications_finisher: typificationFinisher,
      typifications_filter_applied: {
        period: true,
        organization: true,
        finisher: Boolean(typificationFinisher),
        user_interaction: includeUserInteraction,
      },
      typifications_rule: includeUserInteraction
        ? "Q11 = tipificação · só sessões com ≥1 mensagem sender_type=user"
        : "Q11 = tipificação",
      period_filter_applied: meses.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
