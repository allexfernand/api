import type {
  AuditorDocumentManifest,
  AuditorDocumentVersion,
} from "./document-types";

export function emptyDocumentManifest(): AuditorDocumentManifest {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    documents: [],
  };
}

export function appendDocumentVersion(
  manifest: AuditorDocumentManifest,
  document: AuditorDocumentVersion,
) {
  const existing = manifest.documents.find((item) => item.id === document.id);
  if (existing) {
    if (existing.pathname !== document.pathname) {
      throw new Error("Identificador de versão duplicado.");
    }
    return existing;
  }
  manifest.documents.push(document);
  return document;
}

export function activateVersion(
  manifest: AuditorDocumentManifest,
  id: string,
  user: string,
  maxActiveBytes: number,
  now = new Date().toISOString(),
) {
  const target = manifest.documents.find((item) => item.id === id);
  if (!target) throw new Error("Versão não encontrada.");
  const otherActiveBytes = manifest.documents
    .filter((item) => item.status === "active" && item.category !== target.category)
    .reduce((total, item) => total + item.size, 0);
  if (otherActiveBytes + target.size > maxActiveBytes) {
    throw new Error("As versões ativas excederiam o limite total de 20 MB.");
  }

  for (const item of manifest.documents) {
    if (item.category === target.category && item.status === "active") {
      item.status = "archived";
      item.archivedAt = now;
      item.archivedBy = user;
    }
  }
  target.status = "active";
  target.activatedAt = now;
  target.activatedBy = user;
  delete target.archivedAt;
  delete target.archivedBy;
  return target;
}

export function archiveVersion(
  manifest: AuditorDocumentManifest,
  id: string,
  user: string,
  now = new Date().toISOString(),
) {
  const target = manifest.documents.find((item) => item.id === id);
  if (!target) throw new Error("Versão não encontrada.");
  target.status = "archived";
  target.archivedAt = now;
  target.archivedBy = user;
  return target;
}
