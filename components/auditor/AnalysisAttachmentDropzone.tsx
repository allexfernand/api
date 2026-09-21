"use client";

import { useRef, useState } from "react";
import styles from "./AnalysisAttachmentDropzone.module.css";

export type LocalAnalysisAttachment = {
  id: string;
  file: File;
  status: "selected" | "uploading" | "ready" | "error";
  progress: number;
  error?: string;
};

type Props = {
  attachments: LocalAnalysisAttachment[];
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AnalysisAttachmentDropzone({
  attachments,
  disabled = false,
  onFiles,
  onRemove,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function receiveFiles(files: FileList | null) {
    if (!files?.length) return;
    onFiles(Array.from(files));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={styles.root}>
      <label
        className={`${styles.dropzone} ${dragging ? styles.dropzoneDragging : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) receiveFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls,.csv,.txt,.md,.docx"
          onChange={(event) => receiveFiles(event.target.files)}
          disabled={disabled}
        />
        <i className="fa-solid fa-paperclip" aria-hidden="true" />
        <span><strong>Adicionar documentos</strong> ou arraste aqui</span>
        <small>PDF, Excel, CSV, TXT, Markdown ou DOCX</small>
      </label>

      {attachments.length ? (
        <ul className={styles.list} aria-label="Documentos desta análise">
          {attachments.map((attachment) => (
            <li className={styles.item} key={attachment.id}>
              <span className={styles.fileIcon}><i className="fa-regular fa-file-lines" aria-hidden="true" /></span>
              <span className={styles.fileInfo}>
                <strong title={attachment.file.name}>{attachment.file.name}</strong>
                <small>
                  {formatBytes(attachment.file.size)}
                  {attachment.status === "uploading" ? ` · ${attachment.progress}%` : ""}
                  {attachment.status === "ready" ? " · pronto" : ""}
                </small>
                {attachment.status === "uploading" ? (
                  <span className={styles.progressTrack} aria-hidden="true">
                    <span style={{ width: `${attachment.progress}%` }} />
                  </span>
                ) : null}
                {attachment.error ? <span className={styles.fileError}>{attachment.error}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                disabled={disabled}
                aria-label={`Remover ${attachment.file.name}`}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
