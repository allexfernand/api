import "server-only";

import fs from "node:fs";
import path from "node:path";
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
const MAX_EXTRACTED_TEXT_CHARS = 2_000_000;

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
  // Import tardio: rotas de casos não precisam inicializar PDF.js/canvas.
  const { PDFParse } = await import("pdf-parse");
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

export async function parseKnowledgeFile(
  bytes: Uint8Array,
  name: string,
  title = name,
): Promise<KnowledgeDocument> {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".pdf") {
    return { title, text: await pdfToText(bytes, name) };
  }
  if (extension === ".xlsx" || extension === ".xls") {
    const workbook = XLSX.read(bytes, {
      type: "buffer",
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
    });
    return { title, text: spreadsheetToText(workbook, name) };
  }
  if (extension === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = result.value.trim();
    if (!text) throw new Error(`O DOCX ${name} não contém texto pesquisável.`);
    if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
      throw new Error(`O DOCX ${name} excede o limite de texto processável.`);
    }
    return { title, text };
  }
  if (extension === ".csv" || extension === ".txt") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
    if (!text) throw new Error(`O arquivo ${name} está vazio.`);
    if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
      throw new Error(`O arquivo ${name} excede o limite de texto processável.`);
    }
    return { title, text };
  }
  throw new Error(`Formato não suportado: ${name}.`);
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
    documents.push(await parseKnowledgeFile(bytes, version.originalName, title));
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

    const bytes = fs.readFileSync(/* turbopackIgnore: true */ fullPath);
    documents.push(await parseKnowledgeFile(new Uint8Array(bytes), name));
  }

  cachedLocalDocuments = documents;
  return documents;
}

export async function loadNivel1Documents() {
  return blobStorageConfigured() ? loadBlobDocuments() : loadLocalDocuments();
}
