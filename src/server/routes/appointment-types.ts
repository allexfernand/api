// api/appointment-types.ts
// Tipos de consulta/agendamento na atendimento_summarized_gold_live.
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

function buildCompanyFilter(columns: string[], company: unknown, p: SqlParams) {
  if (!company) return '';
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return '';
  return `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) = UPPER(TRIM(${p.add(company)}))`;
}

function lastNMonthsList(n: number) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
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
  const meses = req.query.meses ? String(req.query.meses).split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupByMonth = req.query.group_by === 'month';
  const distinctCpf = req.query.dedupe === 'distinct_cpf' || req.query.dedupe === 'cpf_day';
  const scope = String(req.query.scope || '');
  const monthList = meses.length ? meses.sort() : lastNMonthsList(Math.min(Math.max(parseInt(String(req.query.months)) || 12, 1), 24));
  const monthRangeFilter = monthList.map((month) => `(
    ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} >= '${month}-01'
    AND ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} < '${nextMonth(month)}-01'
  )`).join(' OR ');

  const typeExpr = `CASE
    WHEN UPPER(assunto) LIKE '%DASA%' THEN 'Exames'
    WHEN UPPER(assunto) LIKE '%CONEXA%' AND UPPER(assunto) LIKE '%PA%' THEN 'Conexa PA'
    WHEN UPPER(assunto) LIKE '%CONEXA%' THEN 'Conexa Eletiva'
    WHEN UPPER(assunto) LIKE '%DENTIST%' OR UPPER(assunto) LIKE '%ODONTO%'
         OR UPPER(assunto) LIKE '%ENDODONT%' OR UPPER(assunto) LIKE '%ORTODONT%'
         OR UPPER(assunto) LIKE '%PROTESIST%' OR UPPER(assunto) LIKE '%BUCOMAXILO%'
         OR UPPER(assunto) LIKE '%BUCO MAXILO%' OR UPPER(assunto) LIKE '%PERIODONT%' THEN 'Odontologia'
    WHEN UPPER(assunto) LIKE '%PSICOLOG%' OR UPPER(assunto) LIKE '%PSIC_LOG%'
         OR UPPER(assunto) LIKE '%NEUROPSIC%' OR UPPER(assunto) LIKE '%PSICOPEDAG%'
         OR UPPER(assunto) LIKE '%NUTRICION%' OR UPPER(assunto) LIKE '%NUTRI__%'
         OR UPPER(assunto) LIKE '%FISIOTERA%'
         OR UPPER(assunto) LIKE '%FONOAUDIO%' OR UPPER(assunto) LIKE '%FONOTERAPIA%'
         OR UPPER(assunto) LIKE '%TERAPIA OCUPACIONAL%' THEN 'Terapias'
    WHEN tipo_solicitacao = 'Médico' THEN 'Consultas'
    WHEN tipo_solicitacao IN ('Exame', 'Exames') THEN 'Exames'
    ELSE 'Outros'
  END`;

  try {
    const warehouseId = await resolveWarehouseId();
    const columns = (groupNames.length || company || partnerBrokerId) ? await getColumns(warehouseId, APPOINTMENTS_TABLE) : [];
    const params = createSqlParams();
    const groupFilter = buildGroupFilter(columns, groupNames, params);
    const companyFilter = buildCompanyFilter(columns, company, params);
    const partnerFilter = buildPartnerFilter(columns, partnerBrokerId, params);

    const monthExpr = `DATE_FORMAT(${quoteIdent(APPOINTMENTS_DATE_COLUMN)}, 'yyyy-MM')`;
    const commonWhere = `
      WHERE (${monthRangeFilter})
        AND UPPER(assunto) NOT IN (
          'ATENDIMENTO WHATSAPP',
          'ATENDIMENTO HUMANO',
          'FORA DE HORÁRIO DE ATENDIMENTO'
        )
        AND LOWER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%http%'
        AND UPPER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%ATENDIMENTO HUMANO%'
        AND UPPER(TRIM(REGEXP_REPLACE(COALESCE(CAST(assunto AS STRING), ''), '[^A-Za-z0-9]+', ' '))) NOT LIKE '%ATENDIMENTO%HUMANO%'
        AND NOT (
          assunto RLIKE '^[A-Z][a-z]+ [A-Z]'
          OR assunto RLIKE '^[A-Z][A-Z]+ [A-Z]'
          OR assunto RLIKE '^ [A-Z]'
        )
        ${groupFilter}
        ${companyFilter}
        ${partnerFilter}`;
    if (scope === 'top_exams') {
      const normalizedAssuntoExpr = `TRIM(REGEXP_REPLACE(TRANSLATE(
        COALESCE(CAST(assunto AS STRING), ''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
      ), '[^A-Za-z0-9]+', ' '))`;
      const normalizedUpperExpr = `UPPER(${normalizedAssuntoExpr})`;
      const examExpr = `CASE
        WHEN ${normalizedUpperExpr} LIKE '%DASA%'
        THEN 'DASA'
        WHEN ${normalizedUpperExpr} LIKE '%ANALISES CLINICAS%'
          OR ${normalizedUpperExpr} LIKE '%ANALISE CLINICA%'
        THEN 'Análises clínicas'
        ELSE COALESCE(NULLIF(INITCAP(LOWER(${normalizedAssuntoExpr})), ''), 'Exame sem descrição')
      END`;
      const rows = await runQuery(warehouseId, `
        WITH filtered_exams AS (
          SELECT ${examExpr} AS exame
          FROM ${APPOINTMENTS_TABLE}
          ${commonWhere}
            AND ${typeExpr} = 'Exames'
        ),
        grouped_exams AS (
          SELECT
            exame,
            COUNT(*) AS total
          FROM filtered_exams
          GROUP BY exame
        ),
        ranked_exams AS (
          SELECT
            exame,
            total,
            ROW_NUMBER() OVER (ORDER BY total DESC, exame ASC) AS rn,
            SUM(total) OVER () AS total_exames
          FROM grouped_exams
        ),
        final_exams AS (
          SELECT exame, total, total_exames, rn
          FROM ranked_exams
          WHERE rn <= 9
          UNION ALL
          SELECT
            'Outros' AS exame,
            SUM(total) AS total,
            MAX(total_exames) AS total_exames,
            10 AS rn
          FROM ranked_exams
          WHERE rn > 9
        )
        SELECT
          exame,
          total,
          total_exames
        FROM final_exams
        WHERE total > 0
        ORDER BY rn
      `, params.list);
      const total = rows.length ? toInt(rows[0][2]) : 0;
      const items = rows.map((row) => {
        const quantidade = toInt(row[1]);
        return {
          exame: String(getCell(row[0]) || 'Exame sem descrição'),
          tipo: String(getCell(row[0]) || 'Exame sem descrição'),
          total: quantidade,
          percentual: total > 0 ? Math.round((quantidade / total) * 1000) / 10 : 0,
        };
      });
      res.status(200).json({
        items,
        total,
        months: monthList,
        source: "atendimento_summarized_gold_live",
        filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId, scope },
      });
      return;
    }
    if (scope === 'top_consultations') {
      const normalizedAssuntoExpr = `TRIM(REGEXP_REPLACE(TRANSLATE(
        COALESCE(CAST(assunto AS STRING), ''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
      ), '[^A-Za-z0-9]+', ' '))`;
      const normalizedUpperExpr = `UPPER(${normalizedAssuntoExpr})`;
      const specialtyExpr = `CASE
        WHEN ${normalizedUpperExpr} LIKE '%CLINICO GERAL%'
          OR ${normalizedUpperExpr} LIKE '%CLINICA MEDICA%'
        THEN 'Clínico geral'
        WHEN ${normalizedUpperExpr} LIKE '%CARDIO%'
        THEN 'Cardiologia'
        WHEN ${normalizedUpperExpr} LIKE '%GINECO%'
          OR ${normalizedUpperExpr} LIKE '%GINICO%'
        THEN 'Ginecologia'
        WHEN ${normalizedUpperExpr} LIKE '%DERMATO%'
        THEN 'Dermatologia'
        WHEN ${normalizedUpperExpr} LIKE '%PSIQUIATR%'
        THEN 'Psiquiatria'
        ELSE COALESCE(NULLIF(INITCAP(LOWER(TRIM(REGEXP_REPLACE(${normalizedAssuntoExpr}, '^(CONSULTA|CONSULTAS|MEDICO|MEDICA) ', '')))), ''), 'Especialidade sem descrição')
      END`;
      const rows = await runQuery(warehouseId, `
        WITH filtered_consultations AS (
          SELECT ${specialtyExpr} AS especialidade
          FROM ${APPOINTMENTS_TABLE}
          ${commonWhere}
            AND ${typeExpr} = 'Consultas'
        ),
        grouped_consultations AS (
          SELECT
            especialidade,
            COUNT(*) AS total
          FROM filtered_consultations
          GROUP BY especialidade
        ),
        ranked_consultations AS (
          SELECT
            especialidade,
            total,
            ROW_NUMBER() OVER (ORDER BY total DESC, especialidade ASC) AS rn,
            SUM(total) OVER () AS total_consultas
          FROM grouped_consultations
        ),
        final_consultations AS (
          SELECT especialidade, total, total_consultas, rn
          FROM ranked_consultations
          WHERE rn <= 9
          UNION ALL
          SELECT
            'Outros' AS especialidade,
            SUM(total) AS total,
            MAX(total_consultas) AS total_consultas,
            10 AS rn
          FROM ranked_consultations
          WHERE rn > 9
        )
        SELECT
          especialidade,
          total,
          total_consultas
        FROM final_consultations
        WHERE total > 0
        ORDER BY rn
      `, params.list);
      const total = rows.length ? toInt(rows[0][2]) : 0;
      const items = rows.map((row) => {
        const quantidade = toInt(row[1]);
        return {
          especialidade: String(getCell(row[0]) || 'Especialidade sem descrição'),
          tipo: String(getCell(row[0]) || 'Especialidade sem descrição'),
          total: quantidade,
          percentual: total > 0 ? Math.round((quantidade / total) * 1000) / 10 : 0,
        };
      });
      res.status(200).json({
        items,
        total,
        months: monthList,
        source: "atendimento_summarized_gold_live",
        filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId, scope },
      });
      return;
    }
    const rows = await runQuery(warehouseId, distinctCpf ? `
      WITH typed_rows AS (
        SELECT
          ${groupByMonth ? `${monthExpr} AS mes,` : ''}
          ${typeExpr} AS tipo_agrupado,
          LPAD(REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', ''), 11, '0') AS cpf_norm
        FROM ${APPOINTMENTS_TABLE}
        ${commonWhere}
          AND cpf_atendido IS NOT NULL
          AND TRIM(CAST(cpf_atendido AS STRING)) != ''
      ),
      deduped AS (
        SELECT DISTINCT
          ${groupByMonth ? 'mes,' : ''}
          tipo_agrupado,
          cpf_norm
        FROM typed_rows
        WHERE cpf_norm IS NOT NULL
          AND cpf_norm != ''
          AND cpf_norm != '00000000000'
      )
      SELECT
        ${groupByMonth ? 'mes,' : ''}
        tipo_agrupado,
        COUNT(*) AS total
      FROM deduped
      GROUP BY ${groupByMonth ? 'mes, ' : ''}tipo_agrupado
      ORDER BY ${groupByMonth ? 'mes ASC, ' : ''}total DESC
    ` : `
      SELECT
        ${groupByMonth ? `${monthExpr} AS mes,` : ''}
        ${typeExpr} AS tipo_agrupado,
        COUNT(*) AS total
      FROM ${APPOINTMENTS_TABLE}
      ${commonWhere}
      GROUP BY ${groupByMonth ? `${monthExpr}, ` : ''}${typeExpr}
      ORDER BY ${groupByMonth ? 'mes ASC, ' : ''}total DESC
    `, params.list);

    if (groupByMonth) {
      res.status(200).json({
        items: rows.map((row) => ({
          mes: String(getCell(row[0]) || ''),
          tipo: String(getCell(row[1]) || 'Outros'),
          total: toInt(row[2]),
        })),
        months: monthList,
        source: "atendimento_summarized_gold_live",
        filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId, dedupe: distinctCpf ? 'distinct_cpf' : null },
      });
      return;
    }

    const total = rows.reduce((acc, row) => acc + toInt(row[1]), 0);
    const items = rows.map((row) => {
      const quantidade = toInt(row[1]);
      return {
        tipo: String(getCell(row[0]) || 'Outros'),
        total: quantidade,
        percentual: total > 0 ? Math.round((quantidade / total) * 1000) / 10 : 0,
      };
    });

    res.status(200).json({
      items,
      total,
      months: monthList,
      source: "atendimento_summarized_gold_live",
      filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId, dedupe: distinctCpf ? 'distinct_cpf' : null },
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
