import "server-only";

import path from "node:path";
import { del, get, head, list } from "@vercel/blob";
import { parseKnowledgeFile, type KnowledgeDocument } from "./knowledge-loader";
import {
  analysisAttachmentPathname,
  MAX_ANALYSIS_ATTACHMENT_BYTES,
  MAX_ANALYSIS_ATTACHMENTS,
  MAX_ANALYSIS_TOTAL_BYTES,
  type AnalysisAttachment,
} from "./types";

export const ANALYSIS_ATTACHMENT_PREFIX = "auditor/analysis-temp/";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".xlsx", ".xls", ".csv", ".txt", ".md", ".docx"]);

let lastCleanupAt = 0;

function validateSignature(bytes: Uint8Array, originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`Formato não permitido em ${originalName}.`);
  if (extension === ".pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error(`${originalName} não possui uma assinatura PDF válida.`);
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if ((extension === ".xlsx" || extension === ".docx") && !isZip) {
    throw new Error(`${originalName} não possui uma assinatura válida.`);
  }
  if (extension === ".xls" && !isOle) {
    throw new Error(`${originalName} não possui uma assinatura Excel válida.`);
  }
  if (
    (extension === ".csv" || extension === ".txt" || extension === ".md") &&
    bytes.slice(0, 4096).includes(0)
  ) {
    throw new Error(`${originalName} não é um arquivo de texto válido.`);
  }
}

function validateReference(attachment: AnalysisAttachment) {
  const expected = analysisAttachmentPathname(attachment.id, attachment.originalName);
  if (attachment.pathname !== expected) throw new Error("Referência de anexo inválida.");
}

export async function loadAnalysisAttachments(
  attachments: AnalysisAttachment[],
): Promise<KnowledgeDocument[]> {
  if (attachments.length > MAX_ANALYSIS_ATTACHMENTS) {
    throw new Error(`Envie no máximo ${MAX_ANALYSIS_ATTACHMENTS} documentos por análise.`);
  }

  let totalBytes = 0;
  const documents: KnowledgeDocument[] = [];
  for (const attachment of attachments) {
    validateReference(attachment);
    const metadata = await head(attachment.pathname);
    if (metadata.size <= 0 || metadata.size > MAX_ANALYSIS_ATTACHMENT_BYTES) {
      throw new Error(`${attachment.originalName} excede o limite de 12 MB.`);
    }
    totalBytes += metadata.size;
    if (totalBytes > MAX_ANALYSIS_TOTAL_BYTES) {
      throw new Error("Os anexos excedem o limite total de 20 MB.");
    }

    const result = await get(attachment.pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) {
      throw new Error(`Anexo não encontrado: ${attachment.originalName}.`);
    }
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    validateSignature(bytes, attachment.originalName);
    documents.push(await parseKnowledgeFile(bytes, attachment.originalName, attachment.originalName));
  }
  return documents;
}

export async function deleteAnalysisAttachments(attachments: AnalysisAttachment[]) {
  const pathnames = attachments.flatMap((attachment) => {
    try {
      validateReference(attachment);
      return [attachment.pathname];
    } catch {
      return [];
    }
  });
  if (pathnames.length) await del(pathnames);
}

export async function cleanupStaleAnalysisAttachments(now = Date.now()) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  const stale: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: ANALYSIS_ATTACHMENT_PREFIX, cursor, limit: 1000 });
    stale.push(
      ...page.blobs
        .filter((blob) => now - blob.uploadedAt.getTime() > STALE_AFTER_MS)
        .map((blob) => blob.pathname),
    );
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  for (let start = 0; start < stale.length; start += 100) {
    await del(stale.slice(start, start + 100));
  }
}
