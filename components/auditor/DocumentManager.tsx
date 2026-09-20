"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DOCUMENT_CATEGORIES,
  documentPathname,
  type AuditorDocumentVersion,
  type DocumentCatalogResponse,
  type DocumentCategory,
} from "../../lib/auditor/document-types";
import styles from "./DocumentManager.module.css";

const EMPTY_CATALOG: DocumentCatalogResponse = {
  configured: false,
  uploadConfigured: false,
  maxActiveBytes: 20 * 1024 * 1024,
  activeBytes: 0,
  documents: [],
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

async function fetchCatalog(signal?: AbortSignal) {
  const response = await fetch("/api/auditor/documents", { cache: "no-store", signal });
  const data = await response.json() as DocumentCatalogResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível carregar os documentos.");
  return data;
}

export default function DocumentManager() {
  const [catalog, setCatalog] = useState<DocumentCatalogResponse>(EMPTY_CATALOG);
  const [category, setCategory] = useState<DocumentCategory>("mame");
  const [versionLabel, setVersionLabel] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      setCatalog(await fetchCatalog());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os documentos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchCatalog(controller.signal)
      .then(setCatalog)
      .catch((cause) => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const grouped = useMemo(() => new Map(DOCUMENT_CATEGORIES.map((item) => [
    item.id,
    catalog.documents.filter((document) => document.category === item.id),
  ])), [catalog.documents]);

  async function handleUpload() {
    if (!file || !versionLabel.trim() || uploading) return;
    setError(null);
    setSuccess(null);
    setUploading(true);
    setProgress(0);

    const id = crypto.randomUUID();
    const metadata = {
      id,
      category,
      versionLabel: versionLabel.trim(),
      effectiveDate: effectiveDate || undefined,
      notes: notes.trim() || undefined,
      originalName: file.name,
    };

    try {
      const blob = await upload(documentPathname(category, id, file.name), file, {
        access: "private",
        handleUploadUrl: "/api/auditor/documents/upload",
        clientPayload: JSON.stringify(metadata),
        contentType: file.type,
        multipart: file.size > 5 * 1024 * 1024,
        onUploadProgress: (event) => setProgress(Math.round(event.percentage)),
      });
      const response = await fetch("/api/auditor/documents/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata, pathname: blob.pathname }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar a versão.");

      setVersionLabel("");
      setEffectiveDate("");
      setNotes("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSuccess("Versão enviada. Revise os dados e ative quando estiver pronta para uso.");
      await loadCatalog();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o documento.");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function updateVersion(document: AuditorDocumentVersion, action: "activate" | "archive") {
    const verb = action === "activate" ? "ativar" : "arquivar";
    if (!window.confirm(`Deseja ${verb} a versão “${document.versionLabel}”?`)) return;
    setActionId(document.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/auditor/documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar a versão.");
      setSuccess(action === "activate"
        ? "Versão ativada. Ela será usada na próxima análise."
        : "Versão arquivada.");
      await loadCatalog();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a versão.");
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className={styles.root}>
      {!catalog.uploadConfigured && !loading ? (
        <div className={styles.setupNotice} role="status">
          <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
          <div>
            <strong>Conecte um Vercel Blob privado para habilitar uploads.</strong>
            <p>O histórico pode ser consultado com OIDC, mas o upload pelo navegador requer BLOB_READ_WRITE_TOKEN.</p>
          </div>
        </div>
      ) : null}

      <section className={styles.uploadPanel} aria-labelledby="document-upload-title">
        <div className={styles.panelHeading}>
          <div>
            <h3 id="document-upload-title">Nova versão</h3>
            <p>O envio não altera as análises até que a versão seja ativada.</p>
          </div>
          <div className={styles.capacity}>
            <span>{formatBytes(catalog.activeBytes)} de {formatBytes(catalog.maxActiveBytes)}</span>
            <div className={styles.capacityTrack}>
              <span style={{ width: `${Math.min(100, (catalog.activeBytes / catalog.maxActiveBytes) * 100)}%` }} />
            </div>
          </div>
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Categoria</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)}>
              {DOCUMENT_CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Identificação da versão</span>
            <input
              value={versionLabel}
              onChange={(event) => setVersionLabel(event.target.value)}
              placeholder="Ex.: V.28 ou RN 667/2026"
              maxLength={80}
            />
          </label>
          <label className={styles.field}>
            <span>Vigente desde</span>
            <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.fileField}`}>
            <span>Arquivo</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <label className={`${styles.field} ${styles.notesField}`}>
            <span>Observação</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="O que mudou nesta versão?"
              rows={2}
              maxLength={500}
            />
          </label>
        </div>

        {uploading ? (
          <div className={styles.progress} role="status">
            <span style={{ width: `${progress}%` }} />
            <strong>{progress}% enviado</strong>
          </div>
        ) : null}
        <div className={styles.formFooter}>
          <span>PDF, XLSX ou XLS · até 12 MB por arquivo</span>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!catalog.uploadConfigured || !file || !versionLabel.trim() || uploading}
            onClick={() => void handleUpload()}
          >
            <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
            {uploading ? "Enviando…" : "Enviar versão"}
          </button>
        </div>
      </section>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {success ? <div className={styles.success} role="status">{success}</div> : null}

      <section className={styles.catalog} aria-labelledby="document-catalog-title">
        <div className={styles.panelHeading}>
          <div>
            <h3 id="document-catalog-title">Base de conhecimento</h3>
            <p>Uma versão ativa por categoria. O histórico permanece disponível para conferência.</p>
          </div>
          <button className={styles.refreshButton} type="button" onClick={() => void loadCatalog()} disabled={loading}>
            <i className="fa-solid fa-rotate" aria-hidden="true" />
            Atualizar
          </button>
        </div>

        <div className={styles.categoryGrid}>
          {DOCUMENT_CATEGORIES.map((item) => {
            const versions = grouped.get(item.id) || [];
            const active = versions.find((version) => version.status === "active");
            return (
              <article className={styles.categoryCard} key={item.id}>
                <header className={styles.categoryHeader}>
                  <div className={styles.categoryIcon}><i className="fa-solid fa-file-shield" aria-hidden="true" /></div>
                  <div>
                    <h4>{item.label}</h4>
                    <p>{item.description}</p>
                  </div>
                  <span className={active ? styles.activeBadge : styles.missingBadge}>
                    {active ? "Ativo" : "Sem versão ativa"}
                  </span>
                </header>

                {active ? <VersionRow document={active} actionId={actionId} onAction={updateVersion} /> : null}

                <details className={styles.historyDetails}>
                  <summary>Histórico de versões <span>{versions.length}</span></summary>
                  <div className={styles.versionList}>
                    {versions.length ? versions.map((version) => (
                      <VersionRow document={version} actionId={actionId} onAction={updateVersion} key={version.id} compact />
                    )) : <p className={styles.emptyVersions}>Nenhuma versão enviada.</p>}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function VersionRow({
  document,
  actionId,
  onAction,
  compact = false,
}: {
  document: AuditorDocumentVersion;
  actionId: string | null;
  onAction: (document: AuditorDocumentVersion, action: "activate" | "archive") => Promise<void>;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.versionRow} ${compact ? styles.versionRowCompact : ""}`}>
      <div className={styles.versionInfo}>
        <strong>{document.versionLabel}</strong>
        <span>Vigência: {formatDate(document.effectiveDate)}</span>
        <span>{formatBytes(document.size)} · enviado por {document.uploadedBy}</span>
        {document.notes ? <p>{document.notes}</p> : null}
      </div>
      <div className={styles.versionActions}>
        <a href={`/api/auditor/documents/${document.id}/download`}>
          <i className="fa-solid fa-download" aria-hidden="true" />
          Baixar
        </a>
        <button
          type="button"
          disabled={actionId === document.id}
          onClick={() => void onAction(document, document.status === "active" ? "archive" : "activate")}
        >
          <i className={`fa-solid ${document.status === "active" ? "fa-box-archive" : "fa-circle-check"}`} aria-hidden="true" />
          {document.status === "active" ? "Arquivar" : "Ativar"}
        </button>
      </div>
    </div>
  );
}
