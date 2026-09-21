import "server-only";

import fs from "node:fs";
import path from "node:path";
import { BlobNotFoundError, get, list, put } from "@vercel/blob";
import { blobStorageConfigured } from "./document-store";

const CASE_PREFIX = "auditor/cases/";
const CASE_EXTENSION = ".md";
const ROOT_KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");

function casesDirectory() {
  const configured = process.env.AUDITOR_CASES_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(ROOT_KNOWLEDGE_DIR, "casos");
}

function sanitizeCaseId(id: string) {
  const sanitized = id.normalize("NFKC").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 120);
  if (!sanitized) throw new Error("Identificador de caso inválido.");
  return sanitized;
}

function casePathname(caseId: string) {
  return `${CASE_PREFIX}${sanitizeCaseId(caseId)}${CASE_EXTENSION}`;
}

function caseIdFromPathname(pathname: string) {
  return pathname.slice(CASE_PREFIX.length, -CASE_EXTENSION.length);
}

export function caseStorageInfo() {
  const blob = blobStorageConfigured();
  const localConfigured = Boolean(process.env.AUDITOR_CASES_DIR?.trim());
  return {
    writable: blob || process.env.VERCEL !== "1" || localConfigured,
    persistent: blob || localConfigured || process.env.VERCEL !== "1",
    provider: blob ? "vercel-blob" : "filesystem",
  } as const;
}

export async function listCases() {
  if (!blobStorageConfigured()) {
    const directory = casesDirectory();
    if (!fs.existsSync(/* turbopackIgnore: true */ directory)) return [];
    return fs.readdirSync(/* turbopackIgnore: true */ directory)
      .filter((file) => file.endsWith(CASE_EXTENSION))
      .map((file) => file.slice(0, -CASE_EXTENSION.length))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  const cases: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: CASE_PREFIX, cursor, limit: 1000 });
    cases.push(
      ...page.blobs
        .map((blob) => blob.pathname)
        .filter((pathname) => pathname.endsWith(CASE_EXTENSION))
        .map(caseIdFromPathname),
    );
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return [...new Set(cases)].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function readCase(caseId: string) {
  if (!blobStorageConfigured()) {
    const file = path.join(casesDirectory(), `${sanitizeCaseId(caseId)}${CASE_EXTENSION}`);
    return fs.existsSync(/* turbopackIgnore: true */ file)
      ? fs.readFileSync(/* turbopackIgnore: true */ file, "utf8")
      : null;
  }

  try {
    const result = await get(casePathname(caseId), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return new Response(result.stream).text();
  } catch (cause) {
    if (cause instanceof BlobNotFoundError) return null;
    throw cause;
  }
}

export async function writeCase(caseId: string, content: string) {
  const storage = caseStorageInfo();
  if (!storage.writable) {
    throw new Error("Persistência de casos não configurada para este ambiente serverless.");
  }

  if (blobStorageConfigured()) {
    await put(casePathname(caseId), content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "text/markdown; charset=utf-8",
      cacheControlMaxAge: 60,
    });
    return;
  }

  const directory = casesDirectory();
  fs.mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true });
  fs.writeFileSync(
    /* turbopackIgnore: true */
    path.join(directory, `${sanitizeCaseId(caseId)}${CASE_EXTENSION}`),
    content,
    { encoding: "utf8", mode: 0o600 },
  );
}
