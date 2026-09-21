"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import {
  categoryLabel,
  type AuditorDocumentVersion,
  type DocumentCatalogResponse,
} from "../../lib/auditor/document-types";
import {
  analysisAttachmentContentType,
  analysisAttachmentPathname,
  MAX_ANALYSIS_ATTACHMENT_BYTES,
  MAX_ANALYSIS_ATTACHMENTS,
  MAX_ANALYSIS_TOTAL_BYTES,
  MODE_LABELS,
  safeAnalysisAttachmentFilename,
  type AnalysisAttachment,
  type AuditorMode,
  type ChatMessage,
} from "../../lib/auditor/types";
import AnalysisAttachmentDropzone, {
  type LocalAnalysisAttachment,
} from "./AnalysisAttachmentDropzone";
import CaseMemoryManager from "./CaseMemoryManager";
import styles from "./AuditorChat.module.css";

const MODES = Object.keys(MODE_LABELS) as AuditorMode[];

type CasesResponse = {
  cases?: string[];
  storage?: { persistent?: boolean };
  error?: string;
};

export default function AuditorChat() {
  const [mode, setMode] = useState<AuditorMode>("analise");
  const [cases, setCases] = useState<string[]>([]);
  const [caseId, setCaseId] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [activeDocuments, setActiveDocuments] = useState<AuditorDocumentVersion[]>([]);
  const [attachments, setAttachments] = useState<LocalAnalysisAttachment[]>([]);
  const [managedStorage, setManagedStorage] = useState(false);
  const [caseManagerOpen, setCaseManagerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistentCases, setPersistentCases] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auditor/cases", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as CasesResponse;
        if (!response.ok) throw new Error(data.error || "Não foi possível listar os casos.");
        setCases(data.cases || []);
        setPersistentCases(data.storage?.persistent !== false);
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      });
    fetch("/api/auditor/documents", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as DocumentCatalogResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar a base ativa.");
        setManagedStorage(data.configured);
        setActiveDocuments(data.documents.filter((document) => document.status === "active"));
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [history, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function updateAttachment(id: string, update: Partial<LocalAnalysisAttachment>) {
    setAttachments((current) =>
      current.map((attachment) => attachment.id === id ? { ...attachment, ...update } : attachment),
    );
  }

  function addAttachments(files: File[]) {
    setError(null);
    const currentKeys = new Set(
      attachments.map((attachment) =>
        `${attachment.file.name}:${attachment.file.size}:${attachment.file.lastModified}`),
    );
    const accepted: LocalAnalysisAttachment[] = [];
    let totalBytes = attachments.reduce((total, attachment) => total + attachment.file.size, 0);

    for (const file of files) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (currentKeys.has(key)) continue;
      if (attachments.length + accepted.length >= MAX_ANALYSIS_ATTACHMENTS) {
        setError(`Envie no máximo ${MAX_ANALYSIS_ATTACHMENTS} documentos por análise.`);
        break;
      }
      if (file.name.length > 180) {
        setError(`O nome de “${file.name}” é muito longo.`);
        continue;
      }
      try {
        safeAnalysisAttachmentFilename(file.name);
      } catch {
        setError(`Formato não permitido em “${file.name}”.`);
        continue;
      }
      if (file.size <= 0 || file.size > MAX_ANALYSIS_ATTACHMENT_BYTES) {
        setError(`“${file.name}” deve ter no máximo 12 MB.`);
        continue;
      }
      if (totalBytes + file.size > MAX_ANALYSIS_TOTAL_BYTES) {
        setError("Os documentos selecionados excedem o limite total de 20 MB.");
        break;
      }
      totalBytes += file.size;
      currentKeys.add(key);
      accepted.push({
        id: crypto.randomUUID(),
        file,
        status: "selected",
        progress: 0,
      });
    }

    if (accepted.length) setAttachments((current) => [...current, ...accepted]);
  }

  async function cleanupRemoteAttachments(items: AnalysisAttachment[]) {
    if (!items.length) return;
    await fetch("/api/auditor/attachments/upload", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
      keepalive: true,
    }).catch(() => null);
  }

  async function uploadAnalysisAttachment(
    attachment: LocalAnalysisAttachment,
    signal: AbortSignal,
  ): Promise<AnalysisAttachment> {
    const uploadId = crypto.randomUUID();
    const pathname = analysisAttachmentPathname(uploadId, attachment.file.name);
    updateAttachment(attachment.id, { status: "uploading", progress: 0, error: undefined });
    try {
      const blob = await upload(pathname, attachment.file, {
        access: "private",
        handleUploadUrl: "/api/auditor/attachments/upload",
        clientPayload: JSON.stringify({
          id: uploadId,
          originalName: attachment.file.name,
          size: attachment.file.size,
        }),
        contentType: analysisAttachmentContentType(attachment.file.name),
        multipart: attachment.file.size > 5 * 1024 * 1024,
        abortSignal: signal,
        onUploadProgress: (event) => {
          updateAttachment(attachment.id, { progress: Math.round(event.percentage) });
        },
      });
      updateAttachment(attachment.id, { status: "ready", progress: 100 });
      return {
        id: uploadId,
        pathname: blob.pathname,
        originalName: attachment.file.name,
        size: attachment.file.size,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha no upload.";
      updateAttachment(attachment.id, { status: "error", progress: 0, error: message });
      throw cause;
    }
  }

  async function handleSend() {
    const content = message.trim();
    if ((!content && attachments.length === 0) || loading) return;

    const attachmentSummary = attachments.length
      ? `Documentos anexados: ${attachments.map((attachment) => attachment.file.name).join(", ")}`
      : "";
    const userMessage: ChatMessage = {
      role: "user",
      content: [content, attachmentSummary].filter(Boolean).join("\n\n"),
    };
    const previousHistory = history;
    const nextHistory = [...previousHistory, userMessage];
    setHistory(nextHistory);
    setMessage("");
    setError(null);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let uploadedAttachments: AnalysisAttachment[] = [];
    try {
      const uploadResults = await Promise.allSettled(
        attachments.map((attachment) => uploadAnalysisAttachment(attachment, controller.signal)),
      );
      uploadedAttachments = uploadResults.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []);
      const failedUpload = uploadResults.find((result) => result.status === "rejected");
      if (failedUpload?.status === "rejected") {
        await cleanupRemoteAttachments(uploadedAttachments);
        throw failedUpload.reason;
      }

      const response = await fetch("/api/auditor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          message: content,
          caseId: caseId || undefined,
          history: previousHistory,
          attachments: uploadedAttachments,
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json() as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error || "A análise não retornou conteúdo.");
      setHistory([...nextHistory, { role: "assistant", content: data.text }]);
      setAttachments([]);
    } catch (cause) {
      await cleanupRemoteAttachments(uploadedAttachments);
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a análise.");
      setHistory(previousHistory);
      setMessage(content);
      setAttachments((current) =>
        current.map((attachment) => ({
          ...attachment,
          status: attachment.status === "error" ? "error" : "selected",
          progress: 0,
        })),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  function resetConversation() {
    abortRef.current?.abort();
    setHistory([]);
    setMessage("");
    setAttachments([]);
    setError(null);
    setLoading(false);
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.controls} aria-label="Configuração da análise">
        <div className={styles.controlGroup}>
          <label className={styles.label} htmlFor="auditor-mode">Modo de trabalho</label>
          <select
            id="auditor-mode"
            className={styles.select}
            value={mode}
            onChange={(event) => setMode(event.target.value as AuditorMode)}
            disabled={loading}
          >
            {MODES.map((item) => <option key={item} value={item}>{MODE_LABELS[item]}</option>)}
          </select>
          <p className={styles.hint}>O modo ajusta a estrutura e o destinatário da resposta.</p>
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.label} htmlFor="auditor-case">Caso vinculado</label>
          <select
            id="auditor-case"
            className={styles.select}
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            disabled={loading || cases.length === 0}
          >
            <option value="">Sem caso vinculado</option>
            {cases.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </select>
          {persistentCases === false ? (
            <p className={styles.warning}>O storage persistente de casos ainda não foi configurado neste ambiente.</p>
          ) : null}
          {persistentCases === true ? (
            <button className={styles.manageCasesButton} type="button" onClick={() => setCaseManagerOpen(true)} disabled={loading}>
              <i className="fa-solid fa-folder-open" aria-hidden="true" />
              Gerenciar memórias
            </button>
          ) : null}
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.label}>Base ativa</span>
          <div className={styles.activeDocuments}>
            {activeDocuments.length ? activeDocuments.map((document) => (
              <span key={document.id} title={document.originalName}>
                {categoryLabel(document.category)} · {document.versionLabel}
              </span>
            )) : <p>{managedStorage ? "Nenhuma versão ativa no storage." : "Documentos locais do projeto."}</p>}
          </div>
        </div>

        <button className={styles.secondaryButton} type="button" onClick={resetConversation} disabled={!history.length && !message}>
          <i className="fa-solid fa-rotate-right" aria-hidden="true" />
          Nova conversa
        </button>

        <div className={styles.safetyNote}>
          <i className="fa-solid fa-shield-halved" aria-hidden="true" />
          <p>A resposta apoia a auditoria, mas exige validação médica e normativa antes do uso externo.</p>
        </div>
      </aside>

      <section className={styles.workspace} aria-label="Conversa com o Auditor Mestre">
        <div className={styles.history} aria-live="polite" aria-busy={loading}>
          {history.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><i className="fa-solid fa-file-waveform" aria-hidden="true" /></span>
              <h3>Inicie uma análise</h3>
              <p>Cole os dados relevantes do caso ou faça uma pergunta técnica. Use somente o mínimo necessário de dados pessoais.</p>
            </div>
          ) : null}

          {history.map((item, index) => (
            <article
              className={item.role === "user" ? styles.userMessage : styles.assistantMessage}
              key={`${item.role}-${index}`}
            >
              <span className={styles.messageLabel}>{item.role === "user" ? "Você" : "Auditor Mestre"}</span>
              <div className={styles.messageText}>{item.content}</div>
            </article>
          ))}
          {loading ? (
            <div className={styles.loading} role="status">
              <span className={styles.loadingDot} />
              Conferindo documentos e normas…
            </div>
          ) : null}
          <div ref={historyEndRef} />
        </div>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <div className={styles.composer}>
          <AnalysisAttachmentDropzone
            attachments={attachments}
            disabled={loading}
            onFiles={addAttachments}
            onRemove={(id) => setAttachments((current) =>
              current.filter((attachment) => attachment.id !== id))}
          />
          <label className={styles.srOnly} htmlFor="auditor-message">Mensagem para análise</label>
          <textarea
            id="auditor-message"
            className={styles.textarea}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Descreva o que deve ser analisado ou envie somente os documentos…"
            rows={5}
            maxLength={40_000}
            disabled={loading}
          />
          <div className={styles.composerFooter}>
            <span className={styles.shortcut}>Até 8 arquivos · 20 MB no total · ⌘/Ctrl + Enter</span>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void handleSend()}
              disabled={loading || (!message.trim() && attachments.length === 0)}
            >
              {loading ? "Analisando…" : "Enviar para análise"}
              <i className="fa-solid fa-arrow-up" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
      {caseManagerOpen ? (
        <CaseMemoryManager
          cases={cases}
          selectedCaseId={caseId}
          onClose={() => setCaseManagerOpen(false)}
          onSaved={(savedCaseId) => {
            setCases((current) => [...new Set([...current, savedCaseId])].sort((a, b) => a.localeCompare(b, "pt-BR")));
            setCaseId(savedCaseId);
            setCaseManagerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
