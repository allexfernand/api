// api/sessions.js
const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function dbFetch(path, options = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId, sql) {
  let data = await dbFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: "50s", on_wait_timeout: "CONTINUE" }),
  });
  let { statement_id: sid, status: { state } } = data;
  while (state === "PENDING" || state === "RUNNING") {
    await new Promise((r) => setTimeout(r, 2000));
    data = await dbFetch(`/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || "Query falhou: " + state);
  return data.result?.data_array || [];
}

function escape(s) { return String(s).replace(/'/g, "''"); }
function quoteIdent(s) { return `\`${String(s).replace(/`/g, "``")}\``; }

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };

function normalizeCpfExpr(expr) {
  const digits = `NULLIF(regexp_replace(TRIM(CAST(${expr} AS STRING)), '[^0-9]', ''), '')`;
  return `CASE
    WHEN ${digits} IS NULL THEN NULL
    WHEN LENGTH(${digits}) < 11 THEN LPAD(${digits}, 11, '0')
    ELSE ${digits}
  END`;
}

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const VW_BENEFICIARIOS = `sanus_databricks.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `sanus_databricks.sanus_prod.organizations`;

function pickColumn(columns, candidates) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

async function getColumns(warehouseId, tableName) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || '').trim())
    .filter((column) => column && !column.startsWith('#'));
}

function jsonValueExpr(variablesColumn, keys) {
  const variables = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  const expressions = keys.flatMap((key) => [
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}')), '')`,
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}.value')), '')`,
  ]);
  return `COALESCE(${expressions.join(', ')})`;
}

function sessionCpfExpr(variablesColumn) {
  if (!variablesColumn) return null;
  const variables = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  const jsonCpf = jsonValueExpr(variablesColumn, [
    'inputcpfholder',
    'inputCpfHolder',
    'input_cpf_holder',
    'cpf_holder',
    'cpfHolder',
    'cpf',
    'CPF',
    'document',
    'documento',
    'document_number',
    'documentNumber',
    'cpf_beneficiario',
    'cpfBeneficiario',
  ]);
  const regexCpf = `NULLIF(regexp_extract(${variables}, '([0-9]{3}[. -]?[0-9]{3}[. -]?[0-9]{3}[. -]?[0-9]{2})', 1), '')`;
  return normalizeCpfExpr(`COALESCE(${jsonCpf}, ${regexCpf})`);
}

function orgIdsSubquery(groupName, company) {
  if (company) {
    return `(SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${escape(company)}')`;
  }
  const g = escape(groupName);
  return `(
    SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
    UNION
    SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
  )`;
}

function orgNamesSubquery(groupName, company) {
  if (company) {
    return `(SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${escape(company)}')`;
  }
  const g = escape(groupName);
  return `(
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
    UNION
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
  )`;
}

function textEqualsExpr(expr, value) {
  return `UPPER(TRIM(CAST(${expr} AS STRING))) = UPPER(TRIM('${escape(value)}'))`;
}

function textInExpr(expr, subquery) {
  return `UPPER(TRIM(CAST(${expr} AS STRING))) IN ${subquery}`;
}

function buildExtraFilter(groupName, company, typeFilter) {
  const conditions = [];
  if (groupName) {
    const g = escape(groupName);
    conditions.push(`b.ID_EMPRESA IN (
      SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
      UNION
      SELECT id FROM ${ORGANIZATIONS_TABLE}
      WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
    )`);
  }
  if (company) {
    const c = escape(company);
    conditions.push(`b.ID_EMPRESA IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${c}')`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) != 'TITULAR'`);
  }
  return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const meses = req.query.meses ? req.query.meses.split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typeFilter = req.query.type || null;
  const useCompanyFilterSum = Boolean(groupName || company);
  const extraFilter = buildExtraFilter(groupName, company, typeFilter);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const needsSessionColumns = meses.length > 0 || Boolean(groupName || company);
    const [sessionColumns, beneficiaryViewColumns] = await Promise.all([
      needsSessionColumns ? getColumns(wh.id, SESSION_TABLE) : Promise.resolve([]),
      useCompanyFilterSum ? getColumns(wh.id, VW_BENEFICIARIOS) : Promise.resolve([]),
    ]);
    const sessionDateColumn = pickColumn(sessionColumns, [
      'created_at',
      'createdAt',
      'creation_time',
      'creationTime',
      'created_time',
      'createdTime',
      'session_created_at',
      'session_creation_time',
      'started_at',
      'start_time',
      'startTime',
      'last_message_at',
      'lastMessageAt',
      'last_interaction_at',
      'lastInteractionAt',
      'updated_at',
      'timestamp',
      'data_criacao',
    ]);
    const variablesColumn = pickColumn(sessionColumns, ['variables']);
    const sessionOrgColumn = pickColumn(sessionColumns, [
      'organization_id',
      'organizationId',
      'org_id',
      'orgId',
      'id_empresa',
      'ID_EMPRESA',
      'empresa_id',
      'company_id',
      'companyId',
    ]);
    const sessionCompanyColumn = pickColumn(sessionColumns, [
      'company',
      'company_name',
      'companyName',
      'nome_cliente',
      'NOME_CLIENTE',
      'organization',
      'organization_name',
      'organizationName',
    ]);
    const sessionGroupColumn = pickColumn(sessionColumns, [
      'grupo_economico',
      'economic_group',
      'economicGroup',
      'group_name',
      'groupName',
    ]);
    const beneficiaryCpfColumn = pickColumn(beneficiaryViewColumns, [
      'cpf',
      'CPF',
      'cpf_beneficiario',
      'CPF_BENEFICIARIO',
      'document',
      'DOCUMENT',
      'documento',
      'DOCUMENTO',
      'document_number',
      'DOCUMENT_NUMBER',
      'cpf_holder',
      'CPF_HOLDER',
    ]);
    const sessionDateFilter = meses.length > 0 && sessionDateColumn
      ? `DATE_FORMAT(try_cast(${quoteIdent(sessionDateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})`
      : null;
    const sessionOrgConditions = [];
    if (groupName || company) {
      const idsSubquery = orgIdsSubquery(groupName, company);
      const namesSubquery = orgNamesSubquery(groupName, company);
      if (sessionOrgColumn) {
        sessionOrgConditions.push(`CAST(${quoteIdent(sessionOrgColumn)} AS STRING) IN ${idsSubquery}`);
      }
      if (sessionCompanyColumn) {
        sessionOrgConditions.push(textInExpr(quoteIdent(sessionCompanyColumn), namesSubquery));
      }
      if (groupName && sessionGroupColumn) {
        sessionOrgConditions.push(textEqualsExpr(quoteIdent(sessionGroupColumn), groupName));
      }
      if (variablesColumn) {
        const variableOrgId = jsonValueExpr(variablesColumn, [
          'organization_id',
          'organizationId',
          'org_id',
          'orgId',
          'id_empresa',
          'ID_EMPRESA',
          'empresa_id',
          'company_id',
          'companyId',
        ]);
        const variableCompany = jsonValueExpr(variablesColumn, [
          'company',
          'company_name',
          'companyName',
          'nome_cliente',
          'NOME_CLIENTE',
          'organization',
          'organization_name',
          'organizationName',
        ]);
        const variableGroup = jsonValueExpr(variablesColumn, [
          'grupo_economico',
          'economic_group',
          'economicGroup',
          'group_name',
          'groupName',
        ]);
        sessionOrgConditions.push(`CAST(${variableOrgId} AS STRING) IN ${idsSubquery}`);
        sessionOrgConditions.push(textInExpr(variableCompany, namesSubquery));
        if (groupName) sessionOrgConditions.push(textEqualsExpr(variableGroup, groupName));
      }
    }
    const sessionOrgFilter = sessionOrgConditions.length ? `(${sessionOrgConditions.join(' OR ')})` : null;
    const sessionFilters = [sessionDateFilter, sessionOrgFilter].filter(Boolean);
    const sessionWhere = sessionFilters.length ? `WHERE ${sessionFilters.join(' AND ')}` : '';
    const sessionCpfFilterExpr = sessionCpfExpr(variablesColumn);
    const canFilterFinishersByBeneficiaryCpf = useCompanyFilterSum && Boolean(beneficiaryCpfColumn && sessionCpfFilterExpr);
    const finishersFilterApplied = {
      period: meses.length === 0 || Boolean(sessionDateColumn),
      organization: !groupName && !company ? true : Boolean(canFilterFinishersByBeneficiaryCpf || sessionOrgFilter),
      type: !typeFilter || canFilterFinishersByBeneficiaryCpf,
    };

    const totalPromise = useCompanyFilterSum
      ? runQuery(wh.id, `
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT NOME_CLIENTE) AS empresas
        FROM ${VW_BENEFICIARIOS} b
        WHERE NOME_CLIENTE IS NOT NULL
          ${extraFilter}
      `)
      : runQuery(wh.id, `
        SELECT COUNT(*) AS total, 0 AS empresas
        FROM ${SESSION_TABLE}
        ${sessionDateFilter ? `WHERE ${sessionDateFilter}` : ''}
      `);

    const combinedPromise = canFilterFinishersByBeneficiaryCpf
      ? runQuery(wh.id, `
        WITH filtered_benef AS (
          SELECT DISTINCT
            b.NOME_CLIENTE AS empresa,
            ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} AS cpf
          FROM ${VW_BENEFICIARIOS} b
          WHERE NOME_CLIENTE IS NOT NULL
            ${extraFilter}
            AND ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} IS NOT NULL
        ),
        sessions_resolved AS (
          SELECT
            finished_by,
            ${sessionCpfFilterExpr} AS cpf
          FROM ${SESSION_TABLE}
          ${sessionDateFilter ? `WHERE ${sessionDateFilter}` : ''}
        )
        SELECT /*+ BROADCAST(fb) */
          fb.empresa AS empresa,
          SUM(CASE WHEN s.finished_by IS NOT NULL THEN 1 ELSE 0 END) AS humano,
          SUM(CASE WHEN s.finished_by IS NULL     THEN 1 ELSE 0 END) AS ia
        FROM sessions_resolved s
        INNER JOIN filtered_benef fb ON fb.cpf = s.cpf
        WHERE s.cpf IS NOT NULL
        GROUP BY fb.empresa
      `)
      : null;

    const finishersFallbackPromise = canFilterFinishersByBeneficiaryCpf
      ? null
      : runQuery(wh.id, `
        SELECT
          CASE
            WHEN finished_by IS NOT NULL THEN 'Humano'
            ELSE 'IA'
          END AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE}
        ${sessionWhere}
        GROUP BY
          CASE
            WHEN finished_by IS NOT NULL THEN 'Humano'
            ELSE 'IA'
          END
      `);

    const [rows, combinedRows, finishersFallbackRows] = await Promise.all([
      totalPromise,
      combinedPromise || Promise.resolve(null),
      finishersFallbackPromise || Promise.resolve(null),
    ]);
    const row = rows[0] || [];
    const total = toInt(row[0]);

    const byCompany = (combinedRows || [])
      .map((r) => {
        const humano = toInt(r[1]);
        const ia = toInt(r[2]);
        return {
          empresa: String(getCell(r[0]) || "—").trim(),
          humano,
          ia,
          total: humano + ia,
        };
      })
      .filter((it) => it.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);

    let rawFinishers;
    if (combinedRows) {
      const sumHumano = (combinedRows || []).reduce((acc, r) => acc + toInt(r[1]), 0);
      const sumIa = (combinedRows || []).reduce((acc, r) => acc + toInt(r[2]), 0);
      rawFinishers = [
        { tipo: "Humano", total: sumHumano },
        { tipo: "IA", total: sumIa },
      ].filter((it) => it.total > 0);
    } else {
      rawFinishers = (finishersFallbackRows || []).map((r) => ({
        tipo: String(getCell(r[0]) || "—"),
        total: toInt(r[1]),
      }));
    }
    const rawFinishersTotal = rawFinishers.reduce((acc, item) => acc + item.total, 0);
    const scaledFinishers = rawFinishersTotal > 0
      ? rawFinishers.map((item) => ({
          ...item,
          total: Math.round((item.total / rawFinishersTotal) * total),
          raw_total: item.total,
        }))
      : [];
    if (scaledFinishers.length > 0) {
      const allocated = scaledFinishers.slice(0, -1).reduce((acc, item) => acc + item.total, 0);
      scaledFinishers[scaledFinishers.length - 1].total = Math.max(total - allocated, 0);
    }
    const finishers = useCompanyFilterSum && rawFinishersTotal > 0
      ? scaledFinishers
      : rawFinishers;

    res.status(200).json({
      total,
      empresas: toInt(row[1]),
      finishers,
      finishers_raw_total: rawFinishersTotal,
      finishers_scaled_to_total: useCompanyFilterSum && rawFinishersTotal > 0,
      finishers_filter_applied: finishersFilterApplied,
      by_company: byCompany,
      source: useCompanyFilterSum ? "company_filter_sum" : "botmaker_session",
      period_filter_applied: useCompanyFilterSum ? false : meses.length === 0 || Boolean(sessionDateColumn),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
