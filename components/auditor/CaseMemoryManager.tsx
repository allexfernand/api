"use client";

import { useEffect, useState } from "react";
import styles from "./CaseMemoryManager.module.css";

type Props = {
  cases: string[];
  selectedCaseId: string;
  onClose: () => void;
  onSaved: (caseId: string) => void;
};

const CASE_TEMPLATE = `# Identificação

- Referência interna:
- Data de abertura:
- Tipo de atendimento:

## Resumo clínico

Registre somente as informações necessárias para a auditoria.

## Itens em análise

-

## Histórico e decisões

-
`;

function normalizedCaseId(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 120);
}

export default function CaseMemoryManager({
  cases,
  selectedCaseId,
  onClose,
  onSaved,
}: Props) {
  const [caseId, setCaseId] = useState(selectedCaseId);
  const [editingExisting, setEditingExisting] = useState(Boolean(selectedCaseId));
  const [content, setContent] = useState(selectedCaseId ? "" : CASE_TEMPLATE);
  const [loading, setLoading] = useState(Boolean(selectedCaseId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCaseId) return;
    const controller = new AbortController();
    fetch(`/api/auditor/cases/${encodeURIComponent(selectedCaseId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as { content?: string; error?: string };
        if (!response.ok || typeof data.content !== "string") {
          throw new Error(data.error || "Não foi possível carregar a memória.");
        }
        setContent(data.content);
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedCaseId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  async function selectCase(nextId: string) {
    setCaseId(nextId);
    setEditingExisting(Boolean(nextId));
    setError(null);
    if (!nextId) {
      setContent(CASE_TEMPLATE);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/auditor/cases/${encodeURIComponent(nextId)}`, {
        cache: "no-store",
      });
      const data = await response.json() as { content?: string; error?: string };
      if (!response.ok || typeof data.content !== "string") {
        throw new Error(data.error || "Não foi possível carregar a memória.");
      }
      setContent(data.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a memória.");
    } finally {
      setLoading(false);
    }
  }

  async function saveCase() {
    const id = normalizedCaseId(caseId);
    if (!id) {
      setError("Informe um identificador para o caso.");
      return;
    }
    if (!content.trim()) {
      setError("A memória do caso não pode ficar vazia.");
      return;
    }
    if (!editingExisting && cases.includes(id)) {
      setError("Este identificador já existe. Selecione o caso na lista para editá-lo.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/auditor/cases/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a memória.");
      onSaved(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a memória.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-memory-title"
      >
        <header className={styles.header}>
          <div>
            <h3 id="case-memory-title">Memórias de casos</h3>
            <p>Contexto persistente e privado usado nas análises vinculadas.</p>
          </div>
          <button className={styles.iconButton} type="button" onClick={onClose} disabled={saving} aria-label="Fechar">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className={styles.toolbar}>
          <label>
            <span>Caso existente</span>
            <select value={editingExisting ? caseId : ""} onChange={(event) => void selectCase(event.target.value)} disabled={saving}>
              <option value="">Novo caso</option>
              {cases.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label>
            <span>Identificador do caso</span>
            <input
              value={caseId}
              onChange={(event) => setCaseId(normalizedCaseId(event.target.value))}
              placeholder="ex.: auditoria_2026_001"
              disabled={saving || editingExisting}
              maxLength={120}
              autoFocus={!selectedCaseId}
            />
          </label>
        </div>

        <label className={styles.editor}>
          <span>Memória em Markdown</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={loading || saving}
            maxLength={250_000}
            spellCheck
            autoFocus={Boolean(selectedCaseId)}
          />
        </label>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <footer className={styles.footer}>
          <p>Use apenas os dados pessoais estritamente necessários para a auditoria.</p>
          <div>
            <button className={styles.cancelButton} type="button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className={styles.saveButton} type="button" onClick={() => void saveCase()} disabled={loading || saving}>
              {saving ? "Salvando…" : "Salvar memória"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
