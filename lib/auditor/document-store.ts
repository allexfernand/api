import "server-only";

import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  head,
  put,
  type GetBlobResult,
} from "@vercel/blob";
import {
  documentPathname,
  documentManifestSchema,
  safeDocumentFilename,
  type AuditorDocumentManifest,
  type AuditorDocumentVersion,
  type UploadMetadata,
} from "./document-types";
import {
  activateVersion,
  appendDocumentVersion,
  archiveVersion,
  emptyDocumentManifest,
} from "./document-manifest";

export const MANIFEST_PATH = "auditor/knowledge/manifest.json";
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
export const MAX_ACTIVE_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".xlsx", ".xls"]);
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function blobStorageConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

export function blobUploadConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export { documentPathname, safeDocumentFilename };

async function streamText(result: GetBlobResult) {
  if (result.statusCode !== 200) return "";
  return new Response(result.stream).text();
}

function isManifestWriteConflict(cause: unknown) {
  if (cause instanceof BlobPreconditionFailedError) return true;
  const message = cause instanceof Error ? cause.message : String(cause);
  return /precondition failed|etag mismatch/i.test(message);
}

export async function readDocumentManifest() {
  if (!blobStorageConfigured()) {
    return { manifest: emptyDocumentManifest(), etag: null as string | null };
  }
  try {
    const result = await get(MANIFEST_PATH, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) {
      return { manifest: emptyDocumentManifest(), etag: null as string | null };
    }
    const parsed = documentManifestSchema.safeParse(JSON.parse(await streamText(result)));
    if (!parsed.success) throw new Error("Manifesto de documentos inválido.");
    return { manifest: parsed.data, etag: result.blob.etag };
  } catch (cause) {
    if (cause instanceof BlobNotFoundError) {
      return { manifest: emptyDocumentManifest(), etag: null as string | null };
    }
    throw cause;
  }
}

async function updateManifest(
  updater: (manifest: AuditorDocumentManifest) => void,
): Promise<AuditorDocumentManifest> {
  if (!blobStorageConfigured()) {
    throw new Error("Vercel Blob privado não configurado.");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { manifest: current, etag } = await readDocumentManifest();
    const next = structuredClone(current);
    updater(next);
    next.revision = current.revision + 1;
    next.updatedAt = new Date().toISOString();
    try {
      await put(MANIFEST_PATH, JSON.stringify(next), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(etag),
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : {}),
      });
      return next;
    } catch (cause) {
      const mayBeConcurrentCreate = !etag && attempt < 2;
      const concurrentUpdate = isManifestWriteConflict(cause) && attempt < 2;
      if (!mayBeConcurrentCreate && !concurrentUpdate) throw cause;
    }
  }
  throw new Error("Não foi possível atualizar o manifesto de documentos.");
}

async function validateBlobSignature(pathname: string, extension: string) {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new Error("Arquivo enviado não encontrado.");
  const reader = result.stream.getReader();
  const first = await reader.read();
  await reader.cancel();
  const bytes = first.value || new Uint8Array();

  if (extension === ".pdf") {
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    if (signature !== "%PDF-") throw new Error("O arquivo não possui uma assinatura PDF válida.");
    return;
  }

  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if ((extension === ".xlsx" && !isZip) || (extension === ".xls" && !isOle)) {
    throw new Error("A planilha não possui uma assinatura Excel válida.");
  }
}

export async function registerUploadedDocument(metadata: UploadMetadata, pathname: string) {
  const expectedPrefix = `auditor/knowledge/${metadata.category}/${metadata.id}/`;
  if (!pathname.startsWith(expectedPrefix)) throw new Error("Caminho de upload inválido.");

  const extension = pathname.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error("Formato de arquivo não permitido.");

  const blob = await head(pathname);
  if (blob.size <= 0 || blob.size > MAX_DOCUMENT_BYTES) {
    throw new Error("O documento deve ter no máximo 12 MB.");
  }
  if (!ALLOWED_CONTENT_TYPES.has(blob.contentType)) {
    throw new Error("Tipo de conteúdo não permitido.");
  }
  await validateBlobSignature(pathname, extension);

  let registered: AuditorDocumentVersion | undefined;
  await updateManifest((manifest) => {
    const next: AuditorDocumentVersion = {
      ...metadata,
      pathname,
      contentType: blob.contentType,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      status: "archived",
    };
    registered = appendDocumentVersion(manifest, next);
  });
  return registered;
}

export async function activateDocumentVersion(id: string, user: string) {
  let activated: AuditorDocumentVersion | undefined;
  await updateManifest((manifest) => {
    activated = activateVersion(manifest, id, user, MAX_ACTIVE_BYTES);
  });
  return activated;
}

export async function archiveDocumentVersion(id: string, user: string) {
  let archived: AuditorDocumentVersion | undefined;
  await updateManifest((manifest) => {
    archived = archiveVersion(manifest, id, user);
  });
  return archived;
}

export async function getDocumentVersion(id: string) {
  const { manifest } = await readDocumentManifest();
  return manifest.documents.find((item) => item.id === id) || null;
}

export async function getActiveDocumentVersions() {
  const { manifest } = await readDocumentManifest();
  return {
    revision: manifest.revision,
    documents: manifest.documents
      .filter((item) => item.status === "active")
      .sort((a, b) => a.category.localeCompare(b.category)),
  };
}

export async function getDocumentCatalog() {
  const { manifest } = await readDocumentManifest();
  const documents = [...manifest.documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return {
    configured: blobStorageConfigured(),
    uploadConfigured: blobUploadConfigured(),
    maxActiveBytes: MAX_ACTIVE_BYTES,
    activeBytes: documents
      .filter((item) => item.status === "active")
      .reduce((total, item) => total + item.size, 0),
    documents,
  };
}

export async function getPrivateDocument(pathname: string) {
  return get(pathname, { access: "private", useCache: false });
}
