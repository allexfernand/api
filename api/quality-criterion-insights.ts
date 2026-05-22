// api/quality-criterion-insights.js
// Insights sob demanda a partir das justificativas factuais dos critérios de qualidade.

import { rejectMdsAuth, requireBasicAuth } from "../lib/basic-auth";

declare const process: { env: Record<string, string | undefined> };

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const CRITERIA_TABLE = "hive_metastore.sanus_prod.quality_analysis_silver_criteria";
const SUMMARY_TABLES = [
  "hive_metastore.sanus_prod.quality_analysis_silver_summary",
];

const DATE_CANDIDATES = ["event_timestamp", "created_at", "creation_time", "data_criacao", "created_date", "timestamp"];
const CRITERION_ID_CANDIDATES = ["criterio_id", "criterion_id", "codigo_criterio", "id_criterio"];
const FACTUAL_JUSTIFICATION_CANDIDATES = [
  "justificativa factual",
  "justificativa_factual",
  "justificativa_fato",
  "factual_justification",
  "justificativa",
];
const APPLICABLE_CANDIDATES = ["is_applicable", "applicable", "aplicavel", "aplicável"];
const ATTENDANCE_CANDIDATES = ["attendance_id", "atendimento_id", "appointment_id"];
const RESOLVED_CANDIDATES = [
  "problema_resolvido",
  "problema resolvido",
  "problema_reslvado",
  "problema reslvado",
  "problem_resolved",
  "problem resolved",
  "resolved",
  "is_resolved",
  "houve_tarefa_concluida",
  "tarefa_concluida",
  "concluido",
  "concluida",
];

async function dbFetch(path, options: any = {}) {
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
const escapeSql = (value) => String(value).replace(/'/g, "''");
const quoteIdent = (value) => `\`${String(value).replace(/`/g, "``")}\``;

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

async function resolveSummaryFilterSchema(warehouseId) {
  for (const table of SUMMARY_TABLES) {
    try {
      const columns = await getColumns(warehouseId, table);
      const summaryAttendanceColumn = pickColumn(columns, ATTENDANCE_CANDIDATES);
      const resolvedColumn = pickColumn(columns, RESOLVED_CANDIDATES);
      if (summaryAttendanceColumn && resolvedColumn) {
        return { summaryTable: table, summaryAttendanceColumn, resolvedColumn };
      }
    } catch (_) {}
  }
  return { summaryTable: SUMMARY_TABLES[0], summaryAttendanceColumn: null, resolvedColumn: null };
}

function applicableCondition(alias, column) {
  if (!column) return "1=1";
  const expr = `LOWER(TRIM(CAST(${alias}.${quoteIdent(column)} AS STRING)))`;
  return `${expr} IN ('true','1','sim','yes','y')`;
}

function resolvedCondition(alias, column, resolved) {
  const expr = `LOWER(TRIM(CAST(${alias}.${quoteIdent(column)} AS STRING)))`;
  return resolved === "sim"
    ? `${expr} IN ('true','1','sim','yes','y','resolved','resolvido','concluido','concluida')`
    : `${expr} IN ('false','0','nao','não','no','n','pending','pendente','aberto')`;
}

function buildWhere({
  criterio,
  meses,
  resolved,
  criterionColumn,
  dateColumn,
  applicableColumn,
  justificationColumn,
  attendanceColumn,
  summaryTable,
  summaryAttendanceColumn,
  resolvedColumn,
}) {
  const conditions = [
    `regexp_extract(regexp_replace(CAST(q.${quoteIdent(criterionColumn)} AS STRING), ',', '.'), '^(\\\\d+)', 1) = '${escapeSql(criterio)}'`,
    applicableCondition("q", applicableColumn),
    `q.${quoteIdent(justificationColumn)} IS NOT NULL`,
    `TRIM(CAST(q.${quoteIdent(justificationColumn)} AS STRING)) != ''`,
  ];

  if (dateColumn) {
    if (meses.length) {
      conditions.push(`DATE_FORMAT(try_cast(q.${quoteIdent(dateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((mes) => `'${escapeSql(mes)}'`).join(",")})`);
    } else {
      conditions.push(`try_cast(q.${quoteIdent(dateColumn)} AS TIMESTAMP) >= current_timestamp() - INTERVAL 30 DAYS`);
    }
  }

  if (resolved) {
    if (!attendanceColumn || !summaryTable || !summaryAttendanceColumn || !resolvedColumn) {
      throw new Error(`Filtro de problema resolvido indisponível. attendance=${attendanceColumn || "n/a"} summary_attendance=${summaryAttendanceColumn || "n/a"} resolved=${resolvedColumn || "n/a"}`);
    }
    conditions.push(`EXISTS (
      SELECT 1
      FROM ${summaryTable} s
      WHERE CAST(s.${quoteIdent(summaryAttendanceColumn)} AS STRING) = CAST(q.${quoteIdent(attendanceColumn)} AS STRING)
        AND ${resolvedCondition("s", resolvedColumn, resolved)}
    )`);
  }

  return conditions.join(" AND ");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildThemes(items) {
  const themeDefs: [string, RegExp][] = [
    ["clareza e orientação", /clar|objetiv|orient|explic|instru/i],
    ["acolhimento e vínculo", /acolh|empati|escuta|sentimento|emoc/i],
    ["resolução e encaminhamento", /resolv|solucion|encaminh|canal|problema/i],
    ["proatividade e continuidade", /proativ|antecip|continuidade|retorno|acompan/i],
    ["segurança clínica", /seguran|crise|risco|urg[eê]ncia|cr[ií]tic/i],
    ["comunicação e escrita", /gram[aá]tic|ortograf|mensagem|linguagem|etiqueta/i],
  ];

  return themeDefs
    .map(([label, regex]) => ({
      label,
      total: items.reduce((acc, item) => acc + (regex.test(item.texto) ? item.total : 0), 0),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);
}

function buildImprovementSuggestions({ criterio, items, themes }) {
  if (!items.length) return [];

  const suggestionByTheme = {
    "clareza e orientação": {
      title: "Padronizar orientações críticas",
      action: "Criar respostas-guia com passo a passo, próximos passos e critérios claros de quando acionar outro canal.",
    },
    "acolhimento e vínculo": {
      title: "Reforçar acolhimento antes da orientação",
      action: "Treinar o time para validar a demanda do beneficiário antes de explicar a solução, usando linguagem empática e personalizada.",
    },
    "resolução e encaminhamento": {
      title: "Fechar o atendimento com encaminhamento explícito",
      action: "Garantir que a mensagem final informe o que foi resolvido, o que ficou pendente, responsável e prazo de retorno.",
    },
    "proatividade e continuidade": {
      title: "Criar checklist de continuidade do cuidado",
      action: "Adicionar perguntas obrigatórias de investigação, expectativa e verificação final antes do encerramento.",
    },
    "segurança clínica": {
      title: "Evidenciar sinais de alerta e conduta segura",
      action: "Usar roteiros com sinais de gravidade, orientação de urgência e escalonamento quando houver risco clínico.",
    },
    "comunicação e escrita": {
      title: "Revisar clareza, etiqueta e escrita",
      action: "Aplicar revisão rápida de tom, estrutura, pontuação e ortografia antes de enviar mensagens sensíveis.",
    },
  };

  const criterionFallbacks = {
    "1": {
      title: "Fortalecer vínculo no primeiro contato",
      action: "Usar abertura acolhedora, validação emocional e personalização antes de orientar o beneficiário.",
    },
    "2": {
      title: "Aumentar foco em resolução",
      action: "Responder com orientação objetiva, caminho de solução e confirmação de entendimento.",
    },
    "3": {
      title: "Melhorar estrutura da comunicação",
      action: "Organizar mensagens em blocos curtos, com saudação, orientação central e fechamento claro.",
    },
    "4": {
      title: "Antecipar necessidades do cuidado",
      action: "Investigar contexto, alinhar expectativa e combinar o próximo passo antes de encerrar.",
    },
    "5": {
      title: "Reforçar segurança clínica",
      action: "Priorizar condutas específicas, sinais de alerta e encaminhamento seguro em cenários críticos.",
    },
  };

  const suggestions = themes
    .map((theme) => {
      const template = suggestionByTheme[theme.label];
      if (!template) return null;
      return {
        title: template.title,
        action: template.action,
        evidence: `${theme.total.toLocaleString("pt-BR")} justificativas mencionam ${theme.label}.`,
      };
    })
    .filter(Boolean);

  if (suggestions.length < 3) {
    const fallback = criterionFallbacks[String(criterio)];
    if (fallback && !suggestions.some((item) => item.title === fallback.title)) {
      suggestions.push({
        ...fallback,
        evidence: "Sugestão complementar baseada no critério selecionado.",
      });
    }
  }

  return suggestions.slice(0, 4);
}

function buildSummary({ criterio, total, atendimentos, themes }) {
  if (!total) return `Não encontrei justificativas factuais para o Critério ${criterio} no período selecionado.`;
  const topThemes = themes.length ? themes.map((item) => item.label).join(", ") : "pontos recorrentes variados";
  return `No período selecionado, o Critério ${criterio} teve ${total.toLocaleString("pt-BR")} justificativas factuais em ${atendimentos.toLocaleString("pt-BR")} atendimentos. Os temas mais recorrentes foram: ${topThemes}.`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (rejectMdsAuth(req, res)) return;

  const criterio = String(req.query.criterio || "").trim();
  const meses = req.query.meses ? String(req.query.meses).split(",").filter((mes) => /^\d{4}-\d{2}$/.test(mes)) : [];
  const resolved = ["sim", "nao"].includes(String(req.query.resolved || "").trim()) ? String(req.query.resolved).trim() : "";
  if (!/^\d+$/.test(criterio)) {
    return res.status(400).json({ error: "Critério inválido." });
  }

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const warehouse = warehouses.find((item) => item.state === "RUNNING") || warehouses[0];
    if (!warehouse) throw new Error("Nenhum SQL Warehouse disponível.");

    const columns = await getColumns(warehouse.id, CRITERIA_TABLE);
    const criterionColumn = pickColumn(columns, CRITERION_ID_CANDIDATES);
    const dateColumn = pickColumn(columns, DATE_CANDIDATES);
    const applicableColumn = pickColumn(columns, APPLICABLE_CANDIDATES);
    const justificationColumn = pickColumn(columns, FACTUAL_JUSTIFICATION_CANDIDATES);
    const attendanceColumn = pickColumn(columns, ATTENDANCE_CANDIDATES);
    const summaryFilter = resolved
      ? await resolveSummaryFilterSchema(warehouse.id)
      : { summaryTable: null, summaryAttendanceColumn: null, resolvedColumn: null };
    if (!criterionColumn || !justificationColumn) {
      throw new Error(`Colunas necessárias não encontradas. criterio=${criterionColumn || "n/a"} justificativa=${justificationColumn || "n/a"}`);
    }

    const where = buildWhere({
      criterio,
      meses,
      resolved,
      criterionColumn,
      dateColumn,
      applicableColumn,
      justificationColumn,
      attendanceColumn,
      summaryTable: summaryFilter.summaryTable,
      summaryAttendanceColumn: summaryFilter.summaryAttendanceColumn,
      resolvedColumn: summaryFilter.resolvedColumn,
    });
    const [summaryRows, justificationRows] = await Promise.all([
      runQuery(warehouse.id, `
        SELECT
          COUNT(*) AS total_justificativas,
          ${attendanceColumn ? `COUNT(DISTINCT CAST(q.${quoteIdent(attendanceColumn)} AS STRING))` : "COUNT(*)"} AS total_atendimentos
        FROM ${CRITERIA_TABLE} q
        WHERE ${where}
      `),
      runQuery(warehouse.id, `
        SELECT
          TRIM(CAST(q.${quoteIdent(justificationColumn)} AS STRING)) AS justificativa,
          COUNT(*) AS total
        FROM ${CRITERIA_TABLE} q
        WHERE ${where}
        GROUP BY TRIM(CAST(q.${quoteIdent(justificationColumn)} AS STRING))
        ORDER BY total DESC
        LIMIT 80
      `),
    ]);

    const total = toInt(summaryRows[0]?.[0]);
    const atendimentos = toInt(summaryRows[0]?.[1]);
    const items = justificationRows.map((row) => ({
      texto: normalizeText(getCell(row[0])),
      total: toInt(row[1]),
    }));
    const themes = buildThemes(items);
    const improvementSuggestions = buildImprovementSuggestions({ criterio, items, themes });

    res.status(200).json({
      criterio,
      total_justificativas: total,
      total_atendimentos: atendimentos,
      resumo: buildSummary({ criterio, total, atendimentos, themes }),
      temas: themes,
      sugestoes_melhoria: improvementSuggestions,
      exemplos: items.slice(0, 6),
      filters: { meses, resolved },
      schema: { criterionColumn, dateColumn, applicableColumn, justificationColumn, attendanceColumn, ...summaryFilter },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
