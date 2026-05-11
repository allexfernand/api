// api/quality.js
// Visões estratégica e operacional de qualidade a partir das tabelas silver.

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const SUMMARY_TABLE = "hive_metastore.sanus_prod.quality_analysis_silver_summary";
const EVALUATED_VOLUME_TABLE = "sanus_databricks.sanus_prod.quality_analysis_silver_summary";
const CRITERIA_TABLE = "hive_metastore.sanus_prod.quality_analysis_silver_criteria";
const EVALUATED_CRITERIA_TABLE = "sanus_databricks.sanus_prod.quality_analysis_silver_criteria";
const SESSION_TABLE = "hive_metastore.sanus_prod.botmaker_session";
const ORGANIZATIONS_TABLE = "hive_metastore.sanus_prod.organizations";

const DATE_CANDIDATES = [
  "event_timestamp", "created_at", "creation_time", "data_criacao", "created_date",
  "analysis_created_at", "analysis_at", "processed_at", "updated_at",
  "hora_criacao_atendimento", "session_created_at", "conversation_started_at",
  "data_atendimento", "dt_atendimento", "date", "timestamp",
];
const SUMMARY_ID_CANDIDATES = [
  "analysis_id", "summary_id", "quality_analysis_id", "atendimento_id", "appointment_id",
  "session_id", "conversation_id", "botmaker_session_id", "ticket_id", "id",
];
const JOIN_KEY_CANDIDATES = SUMMARY_ID_CANDIDATES.filter((column) => column !== "id");
const SCORE_CANDIDATES = [
  "overall_score", "score_geral", "general_score", "quality_score", "score_percentual",
  "score_pct", "percentual", "final_score", "nota_final", "score", "nota",
];
const RESOLVED_CANDIDATES = [
  "problem_resolved", "problema_resolvido", "resolved", "is_resolved",
  "houve_tarefa_concluida", "tarefa_concluida", "concluido", "concluida",
];
const ORG_CANDIDATES = [
  "company", "company_name", "empresa", "nome_empresa", "NOME_CLIENTE", "nome_cliente",
  "organization", "organization_name", "bot_company", "bot company",
];
const GROUP_CANDIDATES = [
  "group_name", "economic_group", "grupo_economico", "grupo", "matriz", "grupo_empresa",
];
const COLLABORATOR_CANDIDATES = [
  "collaborator_name", "colaborador", "agent_name", "attendant_name", "nome_colaborador",
  "responsavel", "finished_by", "operator_name", "user_name",
];
const PATIENT_CANDIDATES = [
  "patient_name", "beneficiary_name", "beneficiario", "nome_beneficiario",
  "nome_paciente", "customer_name", "cliente", "paciente",
];
const CARE_LINE_CANDIDATES = [
  "care_line", "linha_cuidado", "linha_de_cuidado", "classification", "classificacao",
  "triage_line", "tipo_cuidado", "perfil",
];
const DURATION_CANDIDATES = [
  "duration_minutes", "duracao_minutos", "duration", "tempo_atendimento_minutos",
  "conversation_duration_minutes", "tempo_conversa",
];
const STATUS_CANDIDATES = ["status", "situacao", "resolution_status", "state"];
const SUBJECT_CANDIDATES = ["subject", "assunto", "topic", "tema", "request_type", "tipo_solicitacao"];
const SUMMARY_TEXT_CANDIDATES = [
  "analysis_summary", "resumo_atendimento", "summary", "conversation_summary",
  "resumo", "descricao", "description",
];

const CRITERION_ID_CANDIDATES = [
  "criterio_id", "criterion_id", "subcriterion_id", "subcriterio_id", "criteria_id", "codigo_criterio",
  "codigo_subcriterio", "criterion_code", "subcriterion_code", "id_criterio",
];
const CRITERION_NAME_CANDIDATES = [
  "sub_criterio", "criterion_name", "subcriterion_name", "subcriterio", "nome_criterio",
  "nome_subcriterio", "criteria_name", "criterio",
];
const PILLAR_ID_CANDIDATES = ["pillar_id", "pilar_id", "pillar_code", "pilar_codigo", "pillar"];
const PILLAR_NAME_CANDIDATES = ["pillar_name", "pilar", "nome_pilar", "pillar_label"];
const CRITERIA_SCORE_CANDIDATES = [
  "pontuacao", "score", "nota", "value", "criterion_score", "score_value", "nota_criterio",
];
const APPLICABLE_CANDIDATES = ["is_applicable", "applicable", "aplicavel", "aplicável"];
const JUSTIFICATION_CANDIDATES = [
  "justification", "justificativa", "reason", "explanation", "motivo", "rationale",
];
const EVIDENCE_CANDIDATES = ["evidence", "evidencia", "trecho", "quote", "excerpt"];
const FINISHER_CANDIDATES = ["finished_by"];
const SUMMARY_SESSION_JOIN_PAIRS = [
  ["attendance_id", "attendance_id"],
  ["attendance_id", "id"],
  ["atendimento_id", "attendance_id"],
  ["atendimento_id", "id"],
  ["appointment_id", "attendance_id"],
  ["appointment_id", "id"],
  ["botmaker_attendance_id", "attendance_id"],
  ["botmaker_attendance_id", "id"],
  ["botmaker_session_id", "id"],
  ["session_id", "id"],
  ["session_id", "session_id"],
  ["conversation_id", "conversation_id"],
  ["ticket_id", "ticket_id"],
];
const CRITERION_MAX_SCORE = 2;

async function dbFetch(path, options = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId, sql) {
  let data = await dbFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement: sql,
      wait_timeout: "50s",
      on_wait_timeout: "CONTINUE",
    }),
  });
  let { statement_id: sid, status: { state } } = data;
  while (state === "PENDING" || state === "RUNNING") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    data = await dbFetch(`/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || `Query falhou: ${state}`);
  return data.result?.data_array || [];
}

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (value) => {
  const number = parseInt(getCell(value), 10);
  return Number.isFinite(number) ? number : 0;
};
const toNumber = (value) => {
  const raw = getCell(value);
  if (raw === null || raw === undefined || raw === "") return null;
  const number = Number(String(raw).replace(",", "."));
  return Number.isFinite(number) ? number : null;
};
const escapeSql = (value) => String(value).replace(/'/g, "''");
const quoteIdent = (value) => `\`${String(value).replace(/`/g, "``")}\``;
const qcol = (alias, column) => `${alias}.${quoteIdent(column)}`;

async function getColumns(warehouseId, tableName) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || "").trim())
    .filter((column) => column && !column.startsWith("#"));
}

function pickColumn(columns, candidates) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const exact = byLower.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const fuzzy = columns.find((column) => column.toLowerCase().replace(/[^a-z0-9]+/g, "") === needle);
    if (fuzzy) return fuzzy;
  }
  return null;
}

function pickSharedColumn(leftColumns, rightColumns, candidates) {
  const rightByLower = new Map(rightColumns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const left = pickColumn(leftColumns, [candidate]);
    if (!left) continue;
    const right = rightByLower.get(left.toLowerCase()) || pickColumn(rightColumns, [candidate]);
    if (right) return { summary: left, criteria: right };
  }
  return null;
}

function pickJoinKey(summaryColumns, criteriaColumns) {
  const exact = pickSharedColumn(summaryColumns, criteriaColumns, JOIN_KEY_CANDIDATES);
  if (exact) return exact;
  const summary = pickColumn(summaryColumns, SUMMARY_ID_CANDIDATES);
  const criteria = pickColumn(criteriaColumns, JOIN_KEY_CANDIDATES);
  if (summary && criteria) return { summary, criteria };
  return null;
}

function pickSummarySessionJoin(summaryColumns, sessionColumns) {
  const candidates = [];
  const seen = new Set();
  for (const [summaryCandidate, sessionCandidate] of SUMMARY_SESSION_JOIN_PAIRS) {
    const summary = pickColumn(summaryColumns, [summaryCandidate]);
    const session = pickColumn(sessionColumns, [sessionCandidate]);
    if (!summary || !session) continue;
    const key = `${summary}|${session}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ summary, session });
  }
  return candidates;
}

function summaryProbeMonthFilter(scope) {
  if (!scope.months.length) return "";
  const monthList = scope.months.map((month) => `'${escapeSql(month)}'`).join(",");
  return `AND DATE_FORMAT(try_cast(s.${quoteIdent("event_timestamp")} AS TIMESTAMP), 'yyyy-MM') IN (${monthList})`;
}

async function resolveSummarySessionJoin(warehouseId, candidates, scope) {
  let best = null;
  for (const candidate of candidates) {
    try {
      const rows = await runQuery(warehouseId, `
        SELECT
          COUNT(*) AS total_matches,
          SUM(CASE WHEN bs.has_humano = 1 THEN 1 ELSE 0 END) AS humano_matches,
          SUM(CASE WHEN bs.has_humano = 0 THEN 1 ELSE 0 END) AS ia_matches
        FROM (
          SELECT DISTINCT CAST(s.${quoteIdent(candidate.summary)} AS STRING) AS join_key
          FROM ${EVALUATED_VOLUME_TABLE} s
          WHERE s.${quoteIdent(candidate.summary)} IS NOT NULL
            ${summaryProbeMonthFilter(scope)}
        ) qs
        INNER JOIN (
          SELECT
            CAST(b.${quoteIdent(candidate.session)} AS STRING) AS join_key,
            MAX(CASE WHEN b.${quoteIdent("finished_by")} IS NOT NULL THEN 1 ELSE 0 END) AS has_humano
          FROM ${SESSION_TABLE} b
          WHERE b.${quoteIdent(candidate.session)} IS NOT NULL
          GROUP BY CAST(b.${quoteIdent(candidate.session)} AS STRING)
        ) bs
          ON qs.join_key = bs.join_key
      `);
      const row = rows[0] || [];
      const total = toInt(row[0]);
      const humano = toInt(row[1]);
      const ia = toInt(row[2]);
      const scored = { ...candidate, total_matches: total, humano_matches: humano, ia_matches: ia };
      if (!best || (humano > 0 && ia > 0 && !(best.humano_matches > 0 && best.ia_matches > 0)) || total > best.total_matches) {
        best = scored;
      }
    } catch (err) {
      // Some candidate pairs can be type-incompatible or too sparse; keep testing the rest.
    }
  }
  return best && best.total_matches > 0 ? best : null;
}

function stringExpr(alias, column, fallback = "Não informado") {
  if (!column) return `'${escapeSql(fallback)}'`;
  return `COALESCE(NULLIF(TRIM(CAST(${qcol(alias, column)} AS STRING)), ''), '${escapeSql(fallback)}')`;
}

function nullableStringExpr(alias, column) {
  if (!column) return "CAST(NULL AS STRING)";
  return `NULLIF(TRIM(CAST(${qcol(alias, column)} AS STRING)), '')`;
}

function numberExpr(alias, column) {
  if (!column) return "CAST(NULL AS DOUBLE)";
  return `try_cast(regexp_replace(regexp_replace(CAST(${qcol(alias, column)} AS STRING), ',', '.'), '[^0-9.-]', '') AS DOUBLE)`;
}

function resolvedExpr(alias, column) {
  if (!column) return "CAST(NULL AS DOUBLE)";
  const expr = `LOWER(TRIM(CAST(${qcol(alias, column)} AS STRING)))`;
  return `CASE
    WHEN ${expr} IN ('true','1','sim','yes','y','resolved','resolvido','concluido','concluida') THEN 1.0
    WHEN ${expr} IN ('false','0','nao','não','no','n','pending','pendente','aberto') THEN 0.0
    ELSE NULL
  END`;
}

function applicableCriteriaCondition(alias, column) {
  if (!column) return null;
  const expr = `LOWER(TRIM(CAST(${qcol(alias, column)} AS STRING)))`;
  return `${expr} IN ('true','1','sim','yes','y')`;
}

function orgNamesSubquery(groupName, company) {
  if (company) {
    return `(SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${escapeSql(company)}')`;
  }
  const group = escapeSql(groupName);
  return `(
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${group}'
    UNION
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${group}' LIMIT 1)
  )`;
}

function buildSummaryScope(columns, query) {
  const groupName = query.group_name || null;
  const company = query.company || null;
  const months = query.meses ? String(query.meses).split(",").filter((month) => /^\d{4}-\d{2}$/.test(month)) : [];
  const dateColumn = pickColumn(columns, DATE_CANDIDATES);
  const orgColumn = pickColumn(columns, ORG_CANDIDATES);
  const groupColumn = pickColumn(columns, GROUP_CANDIDATES);
  const conditions = ["1=1"];
  const filtersApplied = { period: false, organization: false };

  if (dateColumn) {
    if (months.length) {
      const monthList = months.map((month) => `'${escapeSql(month)}'`).join(",");
      conditions.push(`DATE_FORMAT(try_cast(${qcol("s", dateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${monthList})`);
    } else {
      conditions.push(`try_cast(${qcol("s", dateColumn)} AS TIMESTAMP) >= current_timestamp() - INTERVAL 30 DAYS`);
    }
    filtersApplied.period = true;
  }

  if ((groupName || company) && orgColumn) {
    conditions.push(`UPPER(TRIM(CAST(${qcol("s", orgColumn)} AS STRING))) IN ${orgNamesSubquery(groupName, company)}`);
    filtersApplied.organization = true;
  } else if (groupName && groupColumn) {
    conditions.push(`UPPER(TRIM(CAST(${qcol("s", groupColumn)} AS STRING))) = UPPER(TRIM('${escapeSql(groupName)}'))`);
    filtersApplied.organization = true;
  }

  return {
    sql: conditions.join(" AND "),
    months,
    dateColumn,
    orgColumn,
    groupColumn,
    filtersApplied,
    groupName,
    company,
  };
}

function buildEvaluatedVolumeWhere(scope) {
  const conditions = [];

  if (scope.months.length) {
    const monthList = scope.months.map((month) => `'${escapeSql(month)}'`).join(",");
    conditions.push(`DATE_FORMAT(try_cast(q.${quoteIdent("event_timestamp")} AS TIMESTAMP), 'yyyy-MM') IN (${monthList})`);
  }

  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

async function loadEvaluatedVolume(warehouseId, scope) {
  const rows = await runQuery(warehouseId, `
    SELECT
      DATE_FORMAT(try_cast(q.${quoteIdent("event_timestamp")} AS TIMESTAMP), 'yyyy-MM') AS mes,
      COUNT(*) AS volume,
      MAX(try_cast(q.${quoteIdent("event_timestamp")} AS TIMESTAMP)) AS latest_at
    FROM ${EVALUATED_VOLUME_TABLE} q
    ${buildEvaluatedVolumeWhere(scope)}
    GROUP BY DATE_FORMAT(try_cast(q.${quoteIdent("event_timestamp")} AS TIMESTAMP), 'yyyy-MM')
    ORDER BY mes
  `);

  const monthly = rows.map((row) => ({
    mes: String(getCell(row[0]) || ""),
    volume: toInt(row[1]),
    latest_at: getCell(row[2]),
  }));
  const latestAt = monthly
    .map((item) => item.latest_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

  return {
    monthly,
    total: monthly.reduce((acc, item) => acc + item.volume, 0),
    latest_at: latestAt,
  };
}

function buildFinisherCondition(alias, column, criteriaFinisher) {
  if (!column || !criteriaFinisher) return null;
  return criteriaFinisher === "humano"
    ? `${alias}.${quoteIdent(column)} IS NOT NULL`
    : `${alias}.${quoteIdent(column)} IS NULL`;
}

function buildEvaluatedCriteriaWhere(scope, criteriaFinisher, criteriaFinishedByColumn) {
  const conditions = [applicableCriteriaCondition("q", "is_applicable")];

  if (scope.months.length) {
    const monthList = scope.months.map((month) => `'${escapeSql(month)}'`).join(",");
    conditions.push(`DATE_FORMAT(try_cast(q.${quoteIdent("event_timestamp")} AS TIMESTAMP), 'yyyy-MM') IN (${monthList})`);
  }

  const finisherCondition = buildFinisherCondition("q", criteriaFinishedByColumn, criteriaFinisher);
  if (finisherCondition) conditions.push(finisherCondition);

  return `WHERE ${conditions.join(" AND ")}`;
}

function buildCriteriaRecordWhere(scope) {
  const conditions = [];
  if (scope.months.length) {
    const monthList = scope.months.map((month) => `'${escapeSql(month)}'`).join(",");
    conditions.push(`DATE_FORMAT(try_cast(q.${quoteIdent("event_timestamp")} AS TIMESTAMP), 'yyyy-MM') IN (${monthList})`);
  }
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

async function loadOverallCriteriaScore(warehouseId, scope) {
  const applicableCondition = applicableCriteriaCondition("q", "is_applicable");
  const rows = await runQuery(warehouseId, `
    SELECT
      SUM(CASE WHEN ${applicableCondition} THEN 1 ELSE 0 END) AS total_criterios_aplicaveis,
      COUNT(*) AS total_criterios_disponiveis,
      COALESCE(SUM(CASE WHEN ${applicableCondition} THEN COALESCE(${numberExpr("q", "pontuacao")}, 0) ELSE 0 END), 0) AS pontuacao_total,
      SUM(CASE WHEN ${applicableCondition} THEN 1 ELSE 0 END) * ${CRITERION_MAX_SCORE} AS pontuacao_maxima,
      COALESCE(SUM(CASE WHEN ${applicableCondition} THEN COALESCE(${numberExpr("q", "pontuacao")}, 0) ELSE 0 END), 0) / NULLIF(SUM(CASE WHEN ${applicableCondition} THEN 1 ELSE 0 END) * ${CRITERION_MAX_SCORE}, 0) * 100 AS score_pct
    FROM ${EVALUATED_CRITERIA_TABLE} q
    ${buildCriteriaRecordWhere(scope)}
  `);
  const row = rows[0] || [];
  return {
    total_criterios: toInt(row[0]),
    total_criterios_disponiveis: toInt(row[1]),
    pontuacao_total: toNumber(row[2]) || 0,
    pontuacao_maxima: toNumber(row[3]) || 0,
    score_pct: toNumber(row[4]),
  };
}

function buildCriteriaFinisherSql(criteriaFinisher, summarySessionJoin, summaryFinishedByColumn, criteriaFinishedByColumn) {
  if (!criteriaFinisher) {
    return { summarySelect: "CAST(NULL AS STRING)", cte: "", join: "", where: "", applied: false, strategy: "none" };
  }

  if (criteriaFinishedByColumn) {
    return {
      summarySelect: "CAST(NULL AS STRING)",
      cte: "",
      join: "",
      where: "",
      applied: true,
      strategy: "criteria.finished_by",
    };
  }

  if (summaryFinishedByColumn) {
    return {
      summarySelect: `CASE
          WHEN MAX(CASE WHEN s.${quoteIdent(summaryFinishedByColumn)} IS NOT NULL THEN 1 ELSE 0 END) = 1 THEN 'humano'
          ELSE 'ia'
        END`,
      cte: "",
      join: "",
      where: `WHERE s.criteria_finisher = '${escapeSql(criteriaFinisher)}'`,
      applied: true,
      strategy: "summary.finished_by",
    };
  }

  if (!summarySessionJoin) {
    return { summarySelect: "CAST(NULL AS STRING)", cte: "", join: "", where: "", applied: false, strategy: "unavailable" };
  }

  return {
    summarySelect: "CAST(NULL AS STRING)",
    cte: `,
    session_finishers AS (
      SELECT
        CAST(b.${quoteIdent(summarySessionJoin.session)} AS STRING) AS session_join_key,
        CASE
          WHEN MAX(CASE WHEN b.${quoteIdent("finished_by")} IS NOT NULL THEN 1 ELSE 0 END) = 1 THEN 'humano'
          ELSE 'ia'
        END AS criteria_finisher
      FROM ${SESSION_TABLE} b
      WHERE b.${quoteIdent(summarySessionJoin.session)} IS NOT NULL
      GROUP BY CAST(b.${quoteIdent(summarySessionJoin.session)} AS STRING)
    )`,
    join: `
    INNER JOIN session_finishers sf
      ON s.session_join_key = sf.session_join_key
      AND sf.criteria_finisher = '${escapeSql(criteriaFinisher)}'`,
    where: "",
    applied: true,
    strategy: "botmaker_session.finished_by",
  };
}

async function loadEvaluatedCriteriaBullets(warehouseId, scope, criteriaFinisher, summarySessionJoin, summaryFinishedByColumn, criteriaFinishedByColumn) {
  const finisherSql = buildCriteriaFinisherSql(criteriaFinisher, summarySessionJoin, summaryFinishedByColumn, criteriaFinishedByColumn);
  const summaryJoinSelect = summarySessionJoin
    ? `MAX(CAST(s.${quoteIdent(summarySessionJoin.summary)} AS STRING))`
    : "CAST(NULL AS STRING)";
  const rows = await runQuery(warehouseId, `
    WITH criteria_by_attendance AS (
      SELECT
        CAST(q.${quoteIdent("criterio_id")} AS STRING) AS criterio_id,
        COALESCE(NULLIF(TRIM(CAST(q.${quoteIdent("sub_criterio")} AS STRING)), ''), 'Sem subcritério') AS sub_criterio,
        CAST(q.${quoteIdent("attendance_id")} AS STRING) AS attendance_id,
        AVG(${numberExpr("q", "pontuacao")}) AS pontuacao_criterio,
        COUNT(*) AS total_avaliacoes
      FROM ${EVALUATED_CRITERIA_TABLE} q
      ${buildEvaluatedCriteriaWhere(scope, criteriaFinisher, criteriaFinishedByColumn)}
      GROUP BY
        CAST(q.${quoteIdent("criterio_id")} AS STRING),
        COALESCE(NULLIF(TRIM(CAST(q.${quoteIdent("sub_criterio")} AS STRING)), ''), 'Sem subcritério'),
        CAST(q.${quoteIdent("attendance_id")} AS STRING)
    ),
    summary_by_attendance AS (
      SELECT
        CAST(s.${quoteIdent("attendance_id")} AS STRING) AS attendance_id,
        ${summaryJoinSelect} AS session_join_key,
        ${finisherSql.summarySelect} AS criteria_finisher,
        AVG(${numberExpr("s", "nota_atendimento")}) AS nota_atendimento,
        AVG(${numberExpr("s", "nota_maxima_possivel")}) AS nota_maxima_possivel
      FROM ${EVALUATED_VOLUME_TABLE} s
      GROUP BY CAST(s.${quoteIdent("attendance_id")} AS STRING)
    )
    ${finisherSql.cte}
    SELECT
      c.criterio_id,
      c.sub_criterio,
      COUNT(*) AS total_atendimentos,
      SUM(c.total_avaliacoes) AS total_avaliacoes,
      AVG(c.pontuacao_criterio) AS pontuacao_media,
      AVG(c.pontuacao_criterio) / ${CRITERION_MAX_SCORE} AS percentual_criterio,
      AVG(s.nota_atendimento) AS nota_atendimento_media,
      AVG(s.nota_maxima_possivel) AS nota_maxima_media,
      AVG(s.nota_atendimento / NULLIF(s.nota_maxima_possivel, 0)) AS percentual_atendimento
    FROM criteria_by_attendance c
    LEFT JOIN summary_by_attendance s
      ON c.attendance_id = s.attendance_id
    ${finisherSql.join}
    ${finisherSql.where}
    GROUP BY c.criterio_id, c.sub_criterio
    ORDER BY total_atendimentos DESC
    LIMIT 12
  `);

  return {
    items: rows.map((row) => ({
      criterio_id: String(getCell(row[0]) || "Critério"),
      sub_criterio: String(getCell(row[1]) || "Sem subcritério"),
      total_atendimentos: toInt(row[2]),
      total_avaliacoes: toInt(row[3]),
      pontuacao_media: toNumber(row[4]),
      percentual_criterio: toNumber(row[5]),
      nota_atendimento_media: toNumber(row[6]),
      nota_maxima_media: toNumber(row[7]),
      percentual_atendimento: toNumber(row[8]),
      criterio_max_score: CRITERION_MAX_SCORE,
    })),
    filter: {
      requested: criteriaFinisher || "",
      applied: finisherSql.applied,
      summary_join_column: summarySessionJoin?.summary || null,
      session_join_column: summarySessionJoin?.session || null,
      summary_finished_by_column: summaryFinishedByColumn || null,
      criteria_finished_by_column: criteriaFinishedByColumn || null,
      strategy: finisherSql.strategy,
      logic: "botmaker_session.finished_by IS NOT NULL => humano; IS NULL => ia",
    },
  };
}

function criteriaRecordDateCondition(scope, criteriaDateColumn) {
  if (!criteriaDateColumn) return null;
  if (scope.months.length) {
    const monthList = scope.months.map((month) => `'${escapeSql(month)}'`).join(",");
    return `DATE_FORMAT(try_cast(${qcol("c", criteriaDateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${monthList})`;
  }
  return `try_cast(${qcol("c", criteriaDateColumn)} AS TIMESTAMP) >= current_timestamp() - INTERVAL 30 DAYS`;
}

function buildCriteriaWithSql(scope, sharedKey, criteriaColumns) {
  const criteriaDateColumn = pickColumn(criteriaColumns, DATE_CANDIDATES);
  const applicableColumn = pickColumn(criteriaColumns, APPLICABLE_CANDIDATES);
  const applicableCondition = applicableCriteriaCondition("c", applicableColumn);
  const dateCondition = criteriaRecordDateCondition(scope, criteriaDateColumn);
  const criteriaConditions = [applicableCondition, dateCondition].filter(Boolean);
  if (sharedKey) {
    return `
      summary_base AS (
        SELECT CAST(${qcol("s", sharedKey.summary)} AS STRING) AS item_key
        FROM ${SUMMARY_TABLE} s
        WHERE ${scope.sql}
      ),
      criteria_base AS (
        SELECT c.*
        FROM ${CRITERIA_TABLE} c
        INNER JOIN summary_base sb
          ON CAST(${qcol("c", sharedKey.criteria)} AS STRING) = sb.item_key
        ${criteriaConditions.length ? `WHERE ${criteriaConditions.join(" AND ")}` : ""}
      )
    `;
  }

  const conditions = ["1=1"];
  conditions.push(...criteriaConditions);
  return `
    criteria_base AS (
      SELECT c.*
      FROM ${CRITERIA_TABLE} c
      WHERE ${conditions.join(" AND ")}
    )
  `;
}

function normalizeSummaryScore(value) {
  const number = toNumber(value);
  if (number === null) return null;
  if (number > 2) return Math.max(0, Math.min(100, number));
  if (number <= 1) return Math.max(0, Math.min(100, number * 100));
  return Math.max(0, Math.min(100, number * 50));
}

function normalizeCriterionScore(rawValue) {
  const raw = getCell(rawValue);
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text || ["N/A", "NA", "NULL", "NONE", "-", "NAN"].includes(text.toUpperCase())) return null;
  const number = Number(text.replace(",", "."));
  if (!Number.isFinite(number)) return null;
  if (number <= 2) return Math.max(0, Math.min(2, Math.round(number)));
  if (number <= 100) return Math.max(0, Math.min(2, Math.round(number / 50)));
  return null;
}

function finalizeScoreGroup(group) {
  const applicable = group.total - group.na;
  const pct = applicable > 0 ? (group.scoreSum / (applicable * 2)) * 100 : null;
  return {
    ...group,
    applicable,
    score_pct: pct === null ? null : Number(pct.toFixed(1)),
    pct_2: group.total > 0 ? Number(((group.score_2 / group.total) * 100).toFixed(1)) : 0,
    pct_1: group.total > 0 ? Number(((group.score_1 / group.total) * 100).toFixed(1)) : 0,
    pct_0: group.total > 0 ? Number(((group.score_0 / group.total) * 100).toFixed(1)) : 0,
    pct_na: group.total > 0 ? Number(((group.na / group.total) * 100).toFixed(1)) : 0,
  };
}

function addScore(group, score, count) {
  group.total += count;
  if (score === null) {
    group.na += count;
    return;
  }
  group.scoreSum += score * count;
  if (score === 2) group.score_2 += count;
  else if (score === 1) group.score_1 += count;
  else group.score_0 += count;
}

function addAttendanceCount(group, count) {
  group.total_atendimentos += count;
}

function emptyScoreGroup(extra) {
  return {
    ...extra,
    total: 0,
    applicable: 0,
    scoreSum: 0,
    score_2: 0,
    score_1: 0,
    score_0: 0,
    na: 0,
    total_atendimentos: 0,
    score_pct: null,
    pct_2: 0,
    pct_1: 0,
    pct_0: 0,
    pct_na: 0,
  };
}

function aggregateCriteria(rows) {
  const criteriaMap = new Map();
  const pillarMap = new Map();

  rows.forEach((row) => {
    const pillarId = String(getCell(row[0]) || "Pilar");
    const pillarName = String(getCell(row[1]) || pillarId);
    const criterionId = String(getCell(row[2]) || "Critério");
    const criterionName = String(getCell(row[3]) || criterionId);
    const score = normalizeCriterionScore(row[4]);
    const count = toInt(row[5]);
    const attendanceCount = toInt(row[6] ?? row[5]);

    const pillarKey = `${pillarId}|${pillarName}`;
    if (!pillarMap.has(pillarKey)) {
      pillarMap.set(pillarKey, emptyScoreGroup({ pillar_id: pillarId, pillar_name: pillarName }));
    }
    addScore(pillarMap.get(pillarKey), score, count);
    addAttendanceCount(pillarMap.get(pillarKey), attendanceCount);

    const criterionKey = `${pillarId}|${criterionId}|${criterionName}`;
    if (!criteriaMap.has(criterionKey)) {
      criteriaMap.set(criterionKey, emptyScoreGroup({
        pillar_id: pillarId,
        pillar_name: pillarName,
        criterion_id: criterionId,
        criterion_name: criterionName,
      }));
    }
    addScore(criteriaMap.get(criterionKey), score, count);
    addAttendanceCount(criteriaMap.get(criterionKey), attendanceCount);
  });

  const pillars = [...pillarMap.values()]
    .map(finalizeScoreGroup)
    .sort((a, b) => String(a.pillar_id).localeCompare(String(b.pillar_id), "pt-BR", { numeric: true }));
  const criteria = [...criteriaMap.values()]
    .map(finalizeScoreGroup)
    .sort((a, b) => {
      const pillarSort = String(a.pillar_id).localeCompare(String(b.pillar_id), "pt-BR", { numeric: true });
      return pillarSort || String(a.criterion_id).localeCompare(String(b.criterion_id), "pt-BR", { numeric: true });
    });

  const totals = finalizeScoreGroup([...pillarMap.values()].reduce((acc, pillar) => {
    acc.total += pillar.total;
    acc.applicable += pillar.applicable;
    acc.scoreSum += pillar.scoreSum;
    acc.score_2 += pillar.score_2;
    acc.score_1 += pillar.score_1;
    acc.score_0 += pillar.score_0;
    acc.na += pillar.na;
    acc.total_atendimentos += pillar.total_atendimentos;
    return acc;
  }, emptyScoreGroup({})));

  return { pillars, criteria, totals };
}

function buildInsightCards(criteria, pillars) {
  const worstCriterion = criteria
    .filter((item) => item.applicable > 0 && item.score_pct !== null)
    .sort((a, b) => a.score_pct - b.score_pct)[0];
  const safetyCriterion = criteria.find((item) => {
    const label = `${item.pillar_id} ${item.pillar_name} ${item.criterion_id} ${item.criterion_name}`.toLowerCase();
    return label.includes("seguran") || label.includes("crise") || String(item.criterion_id).startsWith("5");
  });
  const weakPillar = pillars
    .filter((item) => item.applicable > 0 && item.score_pct !== null)
    .sort((a, b) => a.score_pct - b.score_pct)[0];

  return [
    worstCriterion ? {
      type: "training",
      title: `${worstCriterion.criterion_id} é o principal gargalo`,
      description: `${worstCriterion.criterion_name} tem ${worstCriterion.score_pct.toFixed(1).replace(".", ",")}% de aproveitamento e ${worstCriterion.pct_0.toFixed(1).replace(".", ",")}% de notas 0.`,
    } : {
      type: "training",
      title: "Dados de critérios ainda insuficientes",
      description: "Assim que houver critérios avaliados, este cartão apontará o melhor foco de treinamento.",
    },
    safetyCriterion ? {
      type: "safety",
      title: `${safetyCriterion.score_0} notas 0 em critério sensível`,
      description: `${safetyCriterion.criterion_id} · ${safetyCriterion.criterion_name} concentra casos que merecem revisão operacional.`,
    } : {
      type: "safety",
      title: weakPillar ? `${weakPillar.pillar_name} requer atenção` : "Sem alerta crítico",
      description: weakPillar ? `Este é o pilar com menor score no período: ${weakPillar.score_pct.toFixed(1).replace(".", ",")}%.` : "Não foram identificados critérios críticos no recorte atual.",
    },
  ];
}

async function loadStrategic(warehouseId, columns, criteriaColumns, scope, sharedKey, criteriaFinisher, summarySessionJoin, summaryFinishedByColumn, criteriaFinishedByColumn) {
  const summaryScoreColumn = pickColumn(columns, SCORE_CANDIDATES);
  const resolvedColumn = pickColumn(columns, RESOLVED_CANDIDATES);
  const collaboratorColumn = pickColumn(columns, COLLABORATOR_CANDIDATES);
  const careLineColumn = pickColumn(columns, CARE_LINE_CANDIDATES);
  const criteriaScoreColumn = pickColumn(criteriaColumns, CRITERIA_SCORE_CANDIDATES);
  const pillarIdColumn = pickColumn(criteriaColumns, PILLAR_ID_CANDIDATES);
  const pillarNameColumn = pickColumn(criteriaColumns, PILLAR_NAME_CANDIDATES);
  const criterionIdColumn = pickColumn(criteriaColumns, CRITERION_ID_CANDIDATES);
  const criterionNameColumn = pickColumn(criteriaColumns, CRITERION_NAME_CANDIDATES);
  const criteriaAttendanceColumn = pickColumn(criteriaColumns, ["attendance_id", "atendimento_id", "appointment_id"]);
  const strategicCriteriaWhere = buildEvaluatedCriteriaWhere(scope, "", null).replace(/\bq\./g, "c.");

  const [summaryRows, criteriaRows, evaluatedVolume, evaluatedCriteria, overallCriteriaScore] = await Promise.all([
    runQuery(warehouseId, `
      SELECT
        COUNT(*) AS total,
        ${scope.dateColumn ? `MAX(try_cast(${qcol("s", scope.dateColumn)} AS TIMESTAMP))` : "CAST(NULL AS TIMESTAMP)"} AS latest_at,
        AVG(${numberExpr("s", summaryScoreColumn)}) AS avg_score,
        AVG(${resolvedExpr("s", resolvedColumn)}) AS resolved_rate
      FROM ${SUMMARY_TABLE} s
      WHERE ${scope.sql}
    `),
    runQuery(warehouseId, `
      SELECT
        ${stringExpr("c", pillarIdColumn, "Pilar")} AS pillar_id,
        ${stringExpr("c", pillarNameColumn, "Sem pilar")} AS pillar_name,
        ${stringExpr("c", criterionIdColumn, "Critério")} AS criterion_id,
        ${stringExpr("c", criterionNameColumn, "Sem critério")} AS criterion_name,
        ${criteriaScoreColumn ? nullableStringExpr("c", criteriaScoreColumn) : "CAST(NULL AS STRING)"} AS score_raw,
        COUNT(*) AS total,
        ${criteriaAttendanceColumn ? `COUNT(DISTINCT CAST(${qcol("c", criteriaAttendanceColumn)} AS STRING))` : "COUNT(*)"} AS total_atendimentos
      FROM ${EVALUATED_CRITERIA_TABLE} c
      ${strategicCriteriaWhere}
      GROUP BY 1, 2, 3, 4, 5
    `),
    loadEvaluatedVolume(warehouseId, scope),
    loadEvaluatedCriteriaBullets(warehouseId, scope, criteriaFinisher, summarySessionJoin, summaryFinishedByColumn, criteriaFinishedByColumn),
    loadOverallCriteriaScore(warehouseId, scope),
  ]);

  const criteriaAgg = aggregateCriteria(criteriaRows);
  const summary = summaryRows[0] || [];
  const summaryScore = normalizeSummaryScore(summary[2]);
  const overallScore = overallCriteriaScore.score_pct !== null ? overallCriteriaScore.score_pct : (criteriaAgg.totals.applicable > 0 ? criteriaAgg.totals.score_pct : summaryScore);
  const resolvedRate = toNumber(summary[3]);
  const weakestPillar = criteriaAgg.pillars
    .filter((item) => item.applicable > 0 && item.score_pct !== null)
    .sort((a, b) => a.score_pct - b.score_pct)[0] || null;

  let collaborators = [];
  if (collaboratorColumn) {
    const rows = await runQuery(warehouseId, `
      SELECT
        ${stringExpr("s", collaboratorColumn, "Sem colaborador")} AS collaborator,
        COUNT(*) AS total,
        AVG(${numberExpr("s", summaryScoreColumn)}) AS avg_score
      FROM ${SUMMARY_TABLE} s
      WHERE ${scope.sql}
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 10
    `);
    collaborators = rows.map((row) => ({
      name: String(getCell(row[0]) || "Sem colaborador"),
      total: toInt(row[1]),
      score_pct: normalizeSummaryScore(row[2]),
    }));
  }

  let careLines = [];
  if (careLineColumn) {
    const rows = await runQuery(warehouseId, `
      SELECT
        ${stringExpr("s", careLineColumn, "Sem linha")} AS care_line,
        COUNT(*) AS total,
        AVG(${numberExpr("s", summaryScoreColumn)}) AS avg_score
      FROM ${SUMMARY_TABLE} s
      WHERE ${scope.sql}
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 8
    `);
    careLines = rows.map((row) => ({
      name: String(getCell(row[0]) || "Sem linha"),
      total: toInt(row[1]),
      score_pct: normalizeSummaryScore(row[2]),
    }));
  }

  return {
    kpis: {
      overall_score: overallScore,
      overall_criteria_score: overallCriteriaScore,
      evaluated: evaluatedVolume.total,
      evaluated_monthly: evaluatedVolume.monthly,
      resolved_pct: resolvedRate === null ? null : Number((resolvedRate * 100).toFixed(1)),
      applicable_criteria: overallCriteriaScore.total_criterios || criteriaAgg.totals.applicable,
      available_criteria: overallCriteriaScore.total_criterios_disponiveis || overallCriteriaScore.total_criterios || criteriaAgg.totals.total,
      na_pct: criteriaAgg.totals.total > 0 ? criteriaAgg.totals.pct_na : null,
      weakest_pillar: weakestPillar,
      latest_at: evaluatedVolume.latest_at || getCell(summary[1]),
    },
    pillars: criteriaAgg.pillars,
    criteria: criteriaAgg.criteria,
    evaluated_criteria: evaluatedCriteria.items,
    criteria_finisher_filter: evaluatedCriteria.filter,
    collaborators,
    care_lines: careLines,
    insights: buildInsightCards(criteriaAgg.criteria, criteriaAgg.pillars),
  };
}

async function loadOperational(warehouseId, columns, criteriaColumns, scope, sharedKey) {
  const summaryIdColumn = sharedKey?.summary || pickColumn(columns, SUMMARY_ID_CANDIDATES);
  const scoreColumn = pickColumn(columns, SCORE_CANDIDATES);
  const patientColumn = pickColumn(columns, PATIENT_CANDIDATES);
  const collaboratorColumn = pickColumn(columns, COLLABORATOR_CANDIDATES);
  const careLineColumn = pickColumn(columns, CARE_LINE_CANDIDATES);
  const durationColumn = pickColumn(columns, DURATION_CANDIDATES);
  const statusColumn = pickColumn(columns, STATUS_CANDIDATES);
  const subjectColumn = pickColumn(columns, SUBJECT_CANDIDATES);
  const summaryTextColumn = pickColumn(columns, SUMMARY_TEXT_CANDIDATES);
  const resolvedColumn = pickColumn(columns, RESOLVED_CANDIDATES);
  const criteriaScoreColumn = pickColumn(criteriaColumns, CRITERIA_SCORE_CANDIDATES);
  const pillarIdColumn = pickColumn(criteriaColumns, PILLAR_ID_CANDIDATES);
  const pillarNameColumn = pickColumn(criteriaColumns, PILLAR_NAME_CANDIDATES);
  const criterionIdColumn = pickColumn(criteriaColumns, CRITERION_ID_CANDIDATES);
  const criterionNameColumn = pickColumn(criteriaColumns, CRITERION_NAME_CANDIDATES);
  const justificationColumn = pickColumn(criteriaColumns, JUSTIFICATION_CANDIDATES);
  const evidenceColumn = pickColumn(criteriaColumns, EVIDENCE_CANDIDATES);

  const dateSelect = scope.dateColumn ? `try_cast(${qcol("s", scope.dateColumn)} AS TIMESTAMP)` : "CAST(NULL AS TIMESTAMP)";
  const orderSql = scope.dateColumn ? `ORDER BY try_cast(${qcol("s", scope.dateColumn)} AS TIMESTAMP) DESC` : "";
  const summaryRows = await runQuery(warehouseId, `
    SELECT
      ${summaryIdColumn ? `CAST(${qcol("s", summaryIdColumn)} AS STRING)` : "CAST(NULL AS STRING)"} AS item_key,
      ${dateSelect} AS created_at,
      ${nullableStringExpr("s", patientColumn)} AS patient_name,
      ${nullableStringExpr("s", collaboratorColumn)} AS collaborator_name,
      ${nullableStringExpr("s", careLineColumn)} AS care_line,
      ${numberExpr("s", durationColumn)} AS duration_minutes,
      ${nullableStringExpr("s", statusColumn)} AS status,
      ${nullableStringExpr("s", subjectColumn)} AS subject,
      ${numberExpr("s", scoreColumn)} AS score,
      ${resolvedExpr("s", resolvedColumn)} AS resolved,
      ${nullableStringExpr("s", summaryTextColumn)} AS summary_text
    FROM ${SUMMARY_TABLE} s
    WHERE ${scope.sql}
    ${orderSql}
    LIMIT 40
  `);

  const items = summaryRows.map((row, index) => ({
    key: String(getCell(row[0]) || `row_${index}`),
    created_at: getCell(row[1]),
    patient_name: getCell(row[2]) || "Paciente não informado",
    collaborator_name: getCell(row[3]) || "Colaborador não informado",
    care_line: getCell(row[4]) || "Sem linha",
    duration_minutes: toNumber(row[5]),
    status: getCell(row[6]) || null,
    subject: getCell(row[7]) || null,
    score_pct: normalizeSummaryScore(row[8]),
    resolved: toNumber(row[9]),
    summary_text: getCell(row[10]) || null,
    criteria: [],
  }));

  const keys = [...new Set(items.map((item) => item.key).filter((key) => key && !key.startsWith("row_")))];
  if (sharedKey && keys.length) {
    const keyList = keys.map((key) => `'${escapeSql(key)}'`).join(",");
    const criteriaRows = await runQuery(warehouseId, `
      SELECT
        CAST(${qcol("c", sharedKey.criteria)} AS STRING) AS item_key,
        ${stringExpr("c", pillarIdColumn, "Pilar")} AS pillar_id,
        ${stringExpr("c", pillarNameColumn, "Sem pilar")} AS pillar_name,
        ${stringExpr("c", criterionIdColumn, "Critério")} AS criterion_id,
        ${stringExpr("c", criterionNameColumn, "Sem critério")} AS criterion_name,
        ${criteriaScoreColumn ? nullableStringExpr("c", criteriaScoreColumn) : "CAST(NULL AS STRING)"} AS score_raw,
        ${nullableStringExpr("c", justificationColumn)} AS justification,
        ${nullableStringExpr("c", evidenceColumn)} AS evidence
      FROM ${CRITERIA_TABLE} c
      WHERE CAST(${qcol("c", sharedKey.criteria)} AS STRING) IN (${keyList})
      ORDER BY 1, 2, 4
      LIMIT 800
    `);

    const byItem = new Map(items.map((item) => [item.key, item]));
    criteriaRows.forEach((row) => {
      const key = String(getCell(row[0]) || "");
      const item = byItem.get(key);
      if (!item) return;
      item.criteria.push({
        pillar_id: String(getCell(row[1]) || "Pilar"),
        pillar_name: String(getCell(row[2]) || "Sem pilar"),
        criterion_id: String(getCell(row[3]) || "Critério"),
        criterion_name: String(getCell(row[4]) || "Sem critério"),
        score: normalizeCriterionScore(row[5]),
        score_raw: getCell(row[5]),
        justification: getCell(row[6]),
        evidence: getCell(row[7]),
      });
    });

    items.forEach((item) => {
      if (item.score_pct !== null || !item.criteria.length) return;
      const scored = item.criteria.filter((criterion) => criterion.score !== null);
      if (!scored.length) return;
      const sum = scored.reduce((acc, criterion) => acc + criterion.score, 0);
      item.score_pct = Number(((sum / (scored.length * 2)) * 100).toFixed(1));
    });
  }

  return { items };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const criteriaFinisher = ["humano", "ia"].includes(String(req.query.criteria_finisher || "").toLowerCase())
      ? String(req.query.criteria_finisher).toLowerCase()
      : "";
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const warehouse = warehouses.find((item) => item.state === "RUNNING") || warehouses[0];
    if (!warehouse) throw new Error("Nenhum SQL Warehouse disponível.");

    const [summaryColumns, criteriaColumns, sessionColumns] = await Promise.all([
      getColumns(warehouse.id, SUMMARY_TABLE),
      getColumns(warehouse.id, CRITERIA_TABLE),
      getColumns(warehouse.id, SESSION_TABLE),
    ]);
    const scope = buildSummaryScope(summaryColumns, req.query);
    const sharedKey = pickJoinKey(summaryColumns, criteriaColumns);
    const summaryFinishedByColumn = pickColumn(summaryColumns, FINISHER_CANDIDATES);
    const criteriaFinishedByColumn = pickColumn(criteriaColumns, FINISHER_CANDIDATES);
    const summarySessionJoinCandidates = pickSummarySessionJoin(summaryColumns, sessionColumns);
    const summarySessionJoin = criteriaFinisher && !summaryFinishedByColumn && !criteriaFinishedByColumn
      ? await resolveSummarySessionJoin(warehouse.id, summarySessionJoinCandidates, scope)
      : null;

    const [strategic, operational] = await Promise.all([
      loadStrategic(warehouse.id, summaryColumns, criteriaColumns, scope, sharedKey, criteriaFinisher, summarySessionJoin, summaryFinishedByColumn, criteriaFinishedByColumn),
      loadOperational(warehouse.id, summaryColumns, criteriaColumns, scope, sharedKey),
    ]);

    res.status(200).json({
      strategic,
      operational,
      filters: {
        group_name: scope.groupName,
        company: scope.company,
        months: scope.months,
        criteria_finisher: criteriaFinisher,
        applied: scope.filtersApplied,
      },
      schema: {
        summary_date_column: scope.dateColumn,
        evaluated_volume_date_column: "event_timestamp",
        summary_org_column: scope.orgColumn,
        summary_group_column: scope.groupColumn,
        summary_session_join: summarySessionJoin,
        summary_session_join_candidates: summarySessionJoinCandidates,
        summary_finished_by_column: summaryFinishedByColumn,
        criteria_finished_by_column: criteriaFinishedByColumn,
        shared_key: sharedKey,
      },
      source: {
        summary: SUMMARY_TABLE,
        evaluated_volume: EVALUATED_VOLUME_TABLE,
        evaluated_criteria: EVALUATED_CRITERIA_TABLE,
        sessions: SESSION_TABLE,
        criteria: CRITERIA_TABLE,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
