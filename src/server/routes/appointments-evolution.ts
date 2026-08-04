// api/appointments-evolution.ts
// Evolução mensal de agendamentos na atendimento_summarized_gold_live.
import {
  MDS_PARTNER_SCOPE,
  requireBasicAuth,
  requireMenuAccess,
  scopedGroupNames,
  scopedPartnerBrokerId,
} from "../../../lib/basic-auth";
import { CORE_DATA_MENUS } from "../../dashboard/menu-catalog";
import { createSqlParams, getCell, getColumns, quoteIdent, resolveWarehouseId, runQuery, toInt, type SqlParams } from "../../../lib/databricks";
import { setApiCors } from "../../../lib/http";

const APPOINTMENTS_TABLE = `hive_metastore.sanus_prod.atendimento_summarized_gold_live`;
const APPOINTMENTS_DATE_COLUMN = 'hora_criacao_atendimento';
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

type ApiRequest = { method?: string; query: Record<string, string | string[] | undefined> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

function pickColumn(columns: string[], candidates: string[]) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

function orgNamesSubquery(groupName: unknown, p: SqlParams) {
  const groups = (Array.isArray(groupName) ? groupName : [groupName]).map((value) => String(value).trim()).filter(Boolean);
  const groupList = groups.map((group) => `UPPER(TRIM(${p.add(group)}))`).join(',');
  return `(
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE}
    WHERE UPPER(TRIM(name)) IN (${groupList})
    UNION
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id IN (
      SELECT id FROM ${ORGANIZATIONS_TABLE}
      WHERE UPPER(TRIM(name)) IN (${groupList})
    )
  )`;
}

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

const companyColumnCandidates = [
  'nome_conta',
  'NOME_CONTA',
  'NOME_CLIENTE',
  'nome_cliente',
  'empresa',
  'Empresa',
  'nome_empresa',
  'NOME_EMPRESA',
  'company',
  'company_name',
];

function buildGroupFilter(columns: string[], groupNames: string[], p: SqlParams) {
  if (!groupNames.length) return '';
  const conditions = [];
  const groupColumn = pickColumn(columns, ['grupo_economico', 'economic_group', 'group_name', 'grupo']);
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (groupColumn) {
    conditions.push(`(${groupNames.map((groupName) => `UPPER(TRIM(CAST(${quoteIdent(groupColumn)} AS STRING))) LIKE CONCAT('%', UPPER(TRIM(${p.add(groupName)})), '%')`).join(' OR ')})`);
  }
  if (companyColumn) {
    conditions.push(`UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${orgNamesSubquery(groupNames, p)}`);
  }
  return conditions.length ? `AND (${conditions.join(' OR ')})` : '';
}

function partnerOrgNamesSubquery(partnerBrokerId: unknown, p: SqlParams) {
  const partnerIds = Array.isArray(partnerBrokerId)
    ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const partnerCondition = partnerIds.length
    ? `CAST(opb.partner_broker_id AS STRING) IN (${p.addAll(partnerIds)})`
    : String(partnerBrokerId) === MDS_PARTNER_SCOPE
    ? `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`
    : `CAST(opb.partner_broker_id AS STRING) = ${p.add(partnerBrokerId)}`;
  return `(
    SELECT UPPER(TRIM(o.name))
    FROM ${ORGANIZATIONS_TABLE} o
    INNER JOIN ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      ON CAST(o.id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION ALL
    SELECT UPPER(TRIM(child.name))
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function buildPartnerFilter(columns: string[], partnerBrokerId: unknown, p: SqlParams) {
  if (!partnerBrokerId) return '';
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return '';
  return `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${partnerOrgNamesSubquery(partnerBrokerId, p)}`;
}

function lastNMonthsList(n: number, includeCurrentMonth = true) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  if (!includeCurrentMonth) d.setUTCMonth(d.getUTCMonth() - 1);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setUTCMonth(d.getUTCMonth() - i);
    const y = dd.getUTCFullYear();
    const m = String(dd.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
  }
  return out;
}

function nextMonth(month: string) {
  const [year, mm] = month.split('-').map((value) => parseInt(value, 10));
  const d = new Date(Date.UTC(year, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function assuntoExclusionSql() {
  const assuntoTextExpr = `UPPER(COALESCE(CAST(assunto AS STRING), ''))`;
  const assuntoNormalizedExpr = `UPPER(TRIM(REGEXP_REPLACE(COALESCE(CAST(assunto AS STRING), ''), '[^A-Za-z0-9]+', ' ')))`;
  return `
    AND UPPER(assunto) NOT IN (
      'ATENDIMENTO WHATSAPP',
      'ATENDIMENTO HUMANO',
      'FORA DE HORÁRIO DE ATENDIMENTO'
    )
    AND LOWER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%http%'
    AND ${assuntoTextExpr} NOT LIKE '%ATENDIMENTO HUMANO%'
    AND ${assuntoNormalizedExpr} NOT LIKE '%ATENDIMENTO%HUMANO%'
    AND NOT (
      assunto RLIKE '^[A-Z][a-z]+ [A-Z]'
      OR assunto RLIKE '^[A-Z][A-Z]+ [A-Z]'
      OR assunto RLIKE '^ [A-Z]'
    )
  `;
}

function appointmentDailyGroupExpr() {
  return `CASE
    WHEN UPPER(COALESCE(CAST(assunto AS STRING), '')) LIKE '%CONEXA%' THEN 'Conexa'
    ELSE 'Agendamentos'
  END`;
}

function normalizedSqlTextExpr(rawExpr: string) {
  return `UPPER(TRIM(REGEXP_REPLACE(TRANSLATE(
    COALESCE(CAST(${rawExpr} AS STRING), ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
  ), '[^A-Za-z0-9]+', ' ')))`;
}

function appointmentStatusGroupExpr(statusExpr: string) {
  const normalizedStatus = normalizedSqlTextExpr(statusExpr);
  return `CASE
    WHEN ${normalizedStatus} LIKE '%LIBERADO%AGENDAMENTO%' THEN 'Liberado para agendamento'
    WHEN ${normalizedStatus} LIKE '%EM%ANDAMENTO%' THEN 'Em andamento'
    WHEN ${normalizedStatus} LIKE '%AGUARDANDO%CONFIRMACAO%BENEFICIARIO%' THEN 'Aguardando confirmação do beneficiário'
    WHEN ${normalizedStatus} LIKE '%FECHADO%' THEN 'Fechado'
    WHEN ${normalizedStatus} LIKE '%REINICIADA%BUSCA%' THEN 'Reiniciada busca'
    WHEN ${normalizedStatus} LIKE '%ESPERA%REDE%' THEN 'Em espera de rede'
    ELSE NULL
  END`;
}

const appointmentRecordColumnCandidates = [
  'id_unico',
  'identificacao_atendimento',
  'record_id',
  'registro_id',
  'card_uuid',
  'card_id',
  'id_card',
  'cardId',
  'agendamento_id',
  'id_agendamento',
  'appointment_id',
  'atendimento_id',
  'id_atendimento',
  'ticket_id',
  'solicitacao_id',
  'id_solicitacao',
  'protocolo',
  'protocol',
  'id',
];

const appointmentStatusColumnCandidates = [
  'card_status',
  'kanban_status',
  'status_card',
  'status_card_nome',
  'status_agendamento',
  'status_name',
  'status_nome',
  'status_descricao',
  'status_atendimento',
  'status',
  'situacao',
  'state',
  'fase',
  'etapa',
  'etapa_atual',
  'coluna',
  'nome_coluna',
];

const appointmentStatusDateColumnCandidates = [
  'status_updated_at',
  'status_atualizado_em',
  'status_created_at',
  'status_criado_em',
  'data_status',
  'hora_status',
  'data_movimentacao',
  'hora_movimentacao',
  'updated_at',
  'update_at',
  'modified_at',
  'data_atualizacao',
  'hora_atualizacao',
  'ultima_atualizacao',
  'created_at',
  APPOINTMENTS_DATE_COLUMN,
];

function daysInMonth(month: string) {
  const days = [];
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(`${nextMonth(month)}-01T00:00:00Z`);
  for (const d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return days;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, CORE_DATA_MENUS)) return;

  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));
  const groupName = groupNames[0] || null;
  const company = req.query.company || null;
  const partnerBrokerId = await scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const granularity = String(req.query.granularity || "month");
  const dayMonth = req.query.mes && /^\d{4}-\d{2}$/.test(String(req.query.mes)) ? String(req.query.mes) : null;
  const meses = req.query.meses ? String(req.query.meses).split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const includeBeneficiaries = String(req.query.include_beneficiaries || "") === "1";
  const onlyBeneficiaries = String(req.query.only_beneficiaries || "") === "1";
  const monthList = meses.length ? meses.sort() : lastNMonthsList(Math.min(Math.max(parseInt(String(req.query.months)) || 12, 1), 24));
  const fullMonthScopes = {
    last_1_month: lastNMonthsList(1, false),
    last_3_months: lastNMonthsList(3, false),
    last_6_months: lastNMonthsList(6, false),
    last_12_months: lastNMonthsList(12, false),
  };
  const monthExpr = `DATE_FORMAT(${quoteIdent(APPOINTMENTS_DATE_COLUMN)}, 'yyyy-MM')`;
  const dayExpr = `DATE_FORMAT(${quoteIdent(APPOINTMENTS_DATE_COLUMN)}, 'yyyy-MM-dd')`;
  const monthRangeFilter = monthList.map((month) => `(
    ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} >= '${month}-01'
    AND ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} < '${nextMonth(month)}-01'
  )`).join(' OR ');
  const selectedDayMonth = dayMonth || monthList[monthList.length - 1];
  const dayRangeFilter = `${quoteIdent(APPOINTMENTS_DATE_COLUMN)} >= '${selectedDayMonth}-01'
    AND ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} < '${nextMonth(selectedDayMonth)}-01'`;

  try {
    const warehouseId = await resolveWarehouseId();

    let companyColumn = null;
    const needsColumns =
      granularity === "status_month" ||
      includeBeneficiaries ||
      groupNames.length ||
      company ||
      partnerBrokerId;
    const columns = needsColumns ? await getColumns(warehouseId, APPOINTMENTS_TABLE) : [];
    const params = createSqlParams();
    const groupFilter = buildGroupFilter(columns, groupNames, params);
    const partnerFilter = buildPartnerFilter(columns, partnerBrokerId, params);
    if (company) companyColumn = pickColumn(columns, companyColumnCandidates);
    const companyFilter = company && companyColumn
      ? `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) = UPPER(TRIM(${params.add(company)}))`
      : '';
    const recordColumn = pickColumn(columns, appointmentRecordColumnCandidates);
    // Mesmo racional do KPI principal: volume de agendamentos (card/registro único),
    // sem deduplicar por CPF.
    const volumeKeyExpr = recordColumn ? `CAST(${quoteIdent(recordColumn)} AS STRING)` : null;
    const volumeCountInMonths = (months: string[]) => {
      const list = months.map((month) => `'${month}'`).join(',');
      return volumeKeyExpr
        ? `COUNT(DISTINCT CASE WHEN mes IN (${list}) THEN record_key END)`
        : `SUM(CASE WHEN mes IN (${list}) THEN 1 ELSE 0 END)`;
    };

    if (granularity === "status_month") {
      const recordColumn = pickColumn(columns, appointmentRecordColumnCandidates);
      const statusColumns = appointmentStatusColumnCandidates
        .map((candidate) => pickColumn(columns, [candidate]))
        .filter((column, index, list): column is string => Boolean(column) && list.indexOf(column) === index);
      const statusDateColumn = pickColumn(columns, appointmentStatusDateColumnCandidates);
      if (!recordColumn || !statusColumns.length || !statusDateColumn) {
        return res.status(400).json({
          error: "Colunas obrigatórias para A05 não encontradas.",
          missing: {
            record_column: !recordColumn,
            status_column: !statusColumns.length,
            status_date_column: !statusDateColumn,
          },
          available_columns: columns,
        });
      }

      const firstMonth = monthList[0];
      const lastMonth = monthList[monthList.length - 1];
      const statusTsExpr = `COALESCE(try_cast(${quoteIdent(statusDateColumn)} AS TIMESTAMP), try_cast(${quoteIdent(APPOINTMENTS_DATE_COLUMN)} AS TIMESTAMP))`;
      const creationTsExpr = `try_cast(${quoteIdent(APPOINTMENTS_DATE_COLUMN)} AS TIMESTAMP)`;
      const statusRawExpr = `COALESCE(${statusColumns.map((column) => `NULLIF(TRIM(CAST(${quoteIdent(column)} AS STRING)), '')`).join(', ')})`;
      const statusGroupExpr = appointmentStatusGroupExpr(statusRawExpr);
      const monthInList = `(${monthList.map((month) => `'${month}'`).join(',')})`;

      const rows = await runQuery(warehouseId, `
        WITH base AS (
          SELECT
            CAST(${quoteIdent(recordColumn)} AS STRING) AS record_key,
            DATE_FORMAT(${creationTsExpr}, 'yyyy-MM') AS mes,
            ${statusRawExpr} AS status_raw,
            ${statusGroupExpr} AS status_group,
            ROW_NUMBER() OVER (
              PARTITION BY CAST(${quoteIdent(recordColumn)} AS STRING)
              ORDER BY ${statusTsExpr} DESC NULLS LAST, ${creationTsExpr} DESC NULLS LAST
            ) AS rn
          FROM ${APPOINTMENTS_TABLE}
          WHERE ${creationTsExpr} >= '${firstMonth}-01'
            AND ${creationTsExpr} < '${nextMonth(lastMonth)}-01'
            AND ${quoteIdent(recordColumn)} IS NOT NULL
            ${assuntoExclusionSql()}
            ${groupFilter}
            ${companyFilter}
            ${partnerFilter}
        )
        SELECT
          mes,
          status_group,
          COUNT(*) AS total
        FROM base
        WHERE rn = 1
          AND mes IN ${monthInList}
          AND status_group IS NOT NULL
        GROUP BY mes, status_group
        ORDER BY mes, status_group
      `, params.list);

      const rawStatusRows = rows.length ? [] : await runQuery(warehouseId, `
        WITH base AS (
          SELECT
            CAST(${quoteIdent(recordColumn)} AS STRING) AS record_key,
            ${statusRawExpr} AS status_raw,
            ${statusGroupExpr} AS status_group,
            ROW_NUMBER() OVER (
              PARTITION BY CAST(${quoteIdent(recordColumn)} AS STRING)
              ORDER BY ${statusTsExpr} DESC NULLS LAST, ${creationTsExpr} DESC NULLS LAST
            ) AS rn
          FROM ${APPOINTMENTS_TABLE}
          WHERE ${creationTsExpr} >= '${firstMonth}-01'
            AND ${creationTsExpr} < '${nextMonth(lastMonth)}-01'
            AND ${quoteIdent(recordColumn)} IS NOT NULL
            ${assuntoExclusionSql()}
            ${groupFilter}
            ${companyFilter}
            ${partnerFilter}
        )
        SELECT status_raw, COUNT(*) AS total
        FROM base
        WHERE rn = 1
          AND status_raw IS NOT NULL
          AND status_group IS NULL
        GROUP BY status_raw
        ORDER BY total DESC
        LIMIT 12
      `, params.list);

      const statuses = [
        'Liberado para agendamento',
        'Em andamento',
        'Aguardando confirmação do beneficiário',
        'Fechado',
        'Reiniciada busca',
        'Em espera de rede',
      ];
      const byMonthStatus = new Map(rows.map((row) => [
        `${String(getCell(row[0]) || '')}|${String(getCell(row[1]) || '')}`,
        toInt(row[2]),
      ]));
      const series = monthList.map((month) => {
        const values = Object.fromEntries(statuses.map((status) => [status, byMonthStatus.get(`${month}|${status}`) || 0]));
        const total = statuses.reduce((sum, status) => sum + Number(values[status] || 0), 0);
        return { mes: month, ...values, total };
      });

      return res.status(200).json({
        granularity: "status_month",
        months: monthList,
        statuses,
        series,
        source: "atendimento_summarized_gold_live.latest_status",
        columns_used: { record: recordColumn, status: statusColumns, status_date: statusDateColumn, month_date: APPOINTMENTS_DATE_COLUMN },
        unmapped_statuses: rawStatusRows.map((row) => ({ status: String(getCell(row[0]) || ''), total: toInt(row[1]) })),
        filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId },
      });
    }

    if (granularity === "day") {
      const groupExpr = appointmentDailyGroupExpr();
      const rows = await runQuery(warehouseId, `
        SELECT
          ${dayExpr} AS dia,
          ${groupExpr} AS grupo,
          COUNT(*) AS total
        FROM ${APPOINTMENTS_TABLE}
        WHERE ${dayRangeFilter}
          ${assuntoExclusionSql()}
          ${groupFilter}
          ${companyFilter}
          ${partnerFilter}
        GROUP BY ${dayExpr}, ${groupExpr}
        ORDER BY dia, grupo
      `, params.list);

      const groups = ['Agendamentos', 'Conexa'];
      const byDiaGrupo = new Map(rows.map((r) => [
        `${String(getCell(r[0]) || '')}|${String(getCell(r[1]) || '')}`,
        toInt(r[2]),
      ]));
      const series = daysInMonth(selectedDayMonth).map((dia) => {
        const values = Object.fromEntries(groups.map((group) => [group, byDiaGrupo.get(`${dia}|${group}`) || 0]));
        const total = groups.reduce((sum, group) => sum + Number(values[group] || 0), 0);
        return { dia, ...values, total };
      });

      return res.status(200).json({
        granularity: "day",
        month: selectedDayMonth,
        groups,
        series,
        source: "atendimento_summarized_gold_live.hora_criacao_atendimento",
        filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId },
        company_column: companyColumn,
        company_filter_applied: !company || Boolean(companyColumn),
      });
    }

    const [rows, beneficiaryRows] = await Promise.all([
      onlyBeneficiaries
        ? Promise.resolve([])
        : runQuery(
            warehouseId,
            `
      SELECT
        ${monthExpr} AS mes,
        COUNT(*) AS total
      FROM ${APPOINTMENTS_TABLE}
      WHERE (${monthRangeFilter})
        ${assuntoExclusionSql()}
        ${groupFilter}
        ${companyFilter}
        ${partnerFilter}
      GROUP BY ${monthExpr}
      ORDER BY mes
    `,
            params.list,
          ),
      includeBeneficiaries
        ? runQuery(
            warehouseId,
            `
      WITH volume_base AS (
        SELECT
          ${monthExpr} AS mes
          ${volumeKeyExpr ? `, ${volumeKeyExpr} AS record_key` : ""}
        FROM ${APPOINTMENTS_TABLE}
        WHERE (${monthRangeFilter})
          ${assuntoExclusionSql()}
          ${groupFilter}
          ${companyFilter}
          ${partnerFilter}
          ${volumeKeyExpr ? `AND ${volumeKeyExpr} IS NOT NULL` : ""}
      )
      SELECT
        mes,
        ${volumeKeyExpr ? "COUNT(DISTINCT record_key)" : "COUNT(*)"} AS volume
      FROM volume_base
      GROUP BY mes
      UNION ALL
      SELECT '__last_1_month', ${volumeCountInMonths(fullMonthScopes.last_1_month)}
      FROM volume_base
      UNION ALL
      SELECT '__last_3_months', ${volumeCountInMonths(fullMonthScopes.last_3_months)}
      FROM volume_base
      UNION ALL
      SELECT '__last_6_months', ${volumeCountInMonths(fullMonthScopes.last_6_months)}
      FROM volume_base
      UNION ALL
      SELECT '__last_12_months', ${volumeKeyExpr ? "COUNT(DISTINCT record_key)" : "COUNT(*)"}
      FROM volume_base
      UNION ALL
      SELECT '__total', ${volumeKeyExpr ? "COUNT(DISTINCT record_key)" : "COUNT(*)"}
      FROM volume_base
    `,
            params.list,
          )
        : Promise.resolve([]),
    ]);

    const byMes = Object.fromEntries(rows.map((r) => [String(getCell(r[0]) || ''), toInt(r[1])]));
    const volumeByMes = new Map<string, number>();
    const utilization = {
      last_1_month: 0,
      last_3_months: 0,
      last_6_months: 0,
      last_12_months: 0,
    };
    let utilizationBase = 0;
    beneficiaryRows.forEach((row) => {
      const key = String(getCell(row[0]) || "");
      const value = toInt(row[1]);
      if (key === "__last_1_month") utilization.last_1_month = value;
      else if (key === "__last_3_months") utilization.last_3_months = value;
      else if (key === "__last_6_months") utilization.last_6_months = value;
      else if (key === "__last_12_months") utilization.last_12_months = value;
      else if (key === "__total") utilizationBase = value;
      else volumeByMes.set(key, value);
    });
    // Fallback: se a query antiga não trouxe __total, usa a janela de 12 meses cheios.
    if (!utilizationBase) utilizationBase = utilization.last_12_months;
    const series = monthList.map((m) => ({
      mes: m,
      total: byMes[m] || 0,
      unique_cpfs: volumeByMes.get(m) || 0,
      unique_beneficiaries: volumeByMes.get(m) || 0,
    }));

    res.status(200).json({
      months: monthList,
      period_months: monthList,
      series,
      utilization,
      utilization_base: utilizationBase,
      utilization_periods: fullMonthScopes,
      beneficiaries_included: Boolean(includeBeneficiaries),
      volume_metric: volumeKeyExpr ? "distinct_record" : "row_count",
      record_column: recordColumn,
      source: "atendimento_summarized_gold_live.hora_criacao_atendimento",
      filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId },
      company_column: companyColumn,
      company_filter_applied: !company || Boolean(companyColumn),
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
