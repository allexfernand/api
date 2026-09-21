import "server-only";

import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import {
  blobStorageConfigured,
  getActiveDocumentVersions,
  getPrivateDocument,
} from "./document-store";
import { categoryLabel } from "./document-types";

const ROOT_KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const PACKAGED_KNOWLEDGE_DIR = path.join(process.cwd(), "auditor-mestre", "knowledge");
const MAX_TOTAL_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SPREADSHEET_TEXT_CHARS = 2_000_000;

export type KnowledgeDocument = {
  title: string;
  text: string;
};

function knowledgeDirectories() {
  return [ROOT_KNOWLEDGE_DIR, PACKAGED_KNOWLEDGE_DIR].filter((directory, index, list) =>
    fs.existsSync(/* turbopackIgnore: true */ directory) && list.indexOf(directory) === index,
  );
}

function nivel1Directories() {
  return knowledgeDirectories()
    .map((directory) => path.join(directory, "nivel1"))
    .filter((directory) => fs.existsSync(/* turbopackIgnore: true */ directory));
}

function casesDirectory() {
  const configured = process.env.AUDITOR_CASES_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(ROOT_KNOWLEDGE_DIR, "casos");
}

function sanitizeCaseId(id: string) {
  const sanitized = id.normalize("NFKC").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 120);
  if (!sanitized) throw new Error("Identificador de caso inválido.");
  return sanitized;
}

export function caseStorageInfo() {
  const configured = Boolean(process.env.AUDITOR_CASES_DIR?.trim());
  return {
    writable: process.env.VERCEL !== "1" || configured,
    persistent: configured || process.env.VERCEL !== "1",
  };
}

export function loadSystemPrompt() {
  for (const directory of knowledgeDirectories()) {
    const file = path.join(directory, "system-prompt.md");
    if (fs.existsSync(/* turbopackIgnore: true */ file)) {
      return fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
    }
  }
  throw new Error("Prompt mestre não encontrado em knowledge/system-prompt.md.");
}

let cachedLocalDocuments: KnowledgeDocument[] | null = null;
let cachedBlobDocuments: { revision: number; documents: KnowledgeDocument[] } | null = null;

function spreadsheetToText(workbook: XLSX.WorkBook, name: string) {
  const text = workbook.SheetNames.map((sheetName) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
    return `## Aba: ${sheetName}\n${csv}`;
  }).join("\n\n");
  if (text.length > MAX_SPREADSHEET_TEXT_CHARS) {
    throw new Error(`Planilha ${name} excede o limite de texto processável.`);
  }
  return text;
}

async function pdfToText(bytes: Uint8Array, name: string) {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = result.pages
      .map((page) => `## Página ${page.num}\n${page.text.trim()}`)
      .join("\n\n")
      .trim();
    if (text.length < 200) {
      throw new Error(`O PDF ${name} não contém texto pesquisável suficiente.`);
    }
    return text;
  } finally {
    await parser.destroy();
  }
}

async function loadBlobDocuments() {
  const active = await getActiveDocumentVersions();
  if (cachedBlobDocuments?.revision === active.revision) return cachedBlobDocuments.documents;

  const totalBytes = active.documents.reduce((total, document) => total + document.size, 0);
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    throw new Error("Base de conhecimento ativa excede o limite de 20 MB.");
  }

  const documents: KnowledgeDocument[] = [];
  for (const version of active.documents) {
    const result = await getPrivateDocument(version.pathname);
    if (!result || result.statusCode !== 200) {
      throw new Error(`Documento ativo não encontrado: ${version.originalName}.`);
    }
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    const title = `${categoryLabel(version.category)} — ${version.versionLabel}`;
    const extension = path.extname(version.originalName).toLowerCase();
    if (extension === ".pdf") {
      documents.push({
        title,
        text: await pdfToText(bytes, version.originalName),
      });
    } else {
      const workbook = XLSX.read(bytes, {
        type: "buffer",
        cellDates: false,
        cellFormula: false,
        cellHTML: false,
      });
      documents.push({
        title,
        text: spreadsheetToText(workbook, version.originalName),
      });
    }
  }

  cachedBlobDocuments = { revision: active.revision, documents };
  return documents;
}

async function loadLocalDocuments() {
  if (cachedLocalDocuments) return cachedLocalDocuments;

  const files = nivel1Directories()
    .flatMap((directory) =>
      fs.readdirSync(/* turbopackIgnore: true */ directory).map((name) => ({ directory, name })),
    )
    .filter(({ name }) => [".pdf", ".xlsx", ".xls"].includes(path.extname(name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  let totalBytes = 0;
  const seen = new Set<string>();
  const documents: KnowledgeDocument[] = [];

  for (const { directory, name } of files) {
    if (seen.has(name.toLocaleLowerCase("pt-BR"))) continue;
    seen.add(name.toLocaleLowerCase("pt-BR"));
    const fullPath = path.join(directory, name);
    const stat = fs.statSync(/* turbopackIgnore: true */ fullPath);
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
      throw new Error("Base de conhecimento Nível 1 excede o limite local de 20 MB.");
    }

    const extension = path.extname(name).toLowerCase();
    if (extension === ".pdf") {
      const bytes = fs.readFileSync(/* turbopackIgnore: true */ fullPath);
      documents.push({
        title: name,
        text: await pdfToText(new Uint8Array(bytes), name),
      });
      continue;
    }

    const workbook = XLSX.readFile(fullPath, { cellDates: false, cellFormula: false, cellHTML: false });
    documents.push({
      title: name,
      text: spreadsheetToText(workbook, name),
    });
  }

  cachedLocalDocuments = documents;
  return documents;
}

export async function loadNivel1Documents() {
  return blobStorageConfigured() ? loadBlobDocuments() : loadLocalDocuments();
}

export function listCases() {
  const directory = casesDirectory();
  if (!fs.existsSync(/* turbopackIgnore: true */ directory)) return [];
  return fs.readdirSync(/* turbopackIgnore: true */ directory)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.replace(/\.md$/, ""))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function readCase(caseId: string) {
  const file = path.join(casesDirectory(), `${sanitizeCaseId(caseId)}.md`);
  return fs.existsSync(/* turbopackIgnore: true */ file)
    ? fs.readFileSync(/* turbopackIgnore: true */ file, "utf8")
    : null;
}

export function writeCase(caseId: string, content: string) {
  const storage = caseStorageInfo();
  if (!storage.writable) {
    throw new Error("Persistência de casos não configurada para este ambiente serverless.");
  }
  const directory = casesDirectory();
  fs.mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true });
  fs.writeFileSync(/* turbopackIgnore: true */ path.join(directory, `${sanitizeCaseId(caseId)}.md`), content, {
    encoding: "utf8",
    mode: 0o600,
  });
}
