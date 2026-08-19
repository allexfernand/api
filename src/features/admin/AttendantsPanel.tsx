"use client";

import { useMemo, useState } from "react";
import styles from "./SettingsTab.module.css";
import { useAttendants } from "./hooks/useAttendants";
import {
  ATTENDANT_DEPARTMENTS,
  type AttendantDepartment,
  type AttendantStatus,
} from "../../contracts/attendants";

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function AttendantsPanel() {
  const {
    status,
    error,
    candidates,
    mappings,
    departments,
    candidatesError,
    candidatesLoading,
    saving,
    reload,
    saveMapping,
  } = useAttendants();
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<"" | AttendantDepartment>("");
  const [statusFilter, setStatusFilter] = useState<"" | AttendantStatus>("");
  const [drafts, setDrafts] = useState<Record<string, { department: AttendantDepartment; status: AttendantStatus }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualDepartment, setManualDepartment] = useState<AttendantDepartment>("Outros");
  const [manualStatus, setManualStatus] = useState<AttendantStatus>("Ativo");

  const mappingByName = useMemo(() => {
    const map = new Map<string, (typeof mappings)[number]>();
    for (const item of mappings) map.set(normalizeKey(item.name), item);
    return map;
  }, [mappings]);

  const rows = useMemo(() => {
    const needle = normalizeKey(search);
    return candidates
      .map((candidate) => {
        const mapped = mappingByName.get(normalizeKey(candidate.name));
        const draft = drafts[candidate.name];
        const department = draft?.department || mapped?.department || "Outros";
        const rowStatus = draft?.status || mapped?.status || "Ativo";
        return {
          name: candidate.name,
          sessions: candidate.sessions,
          lastSeen: candidate.lastSeen,
          department,
          status: rowStatus,
          mapped: Boolean(mapped),
        };
      })
      .filter((row) => {
        if (needle && !normalizeKey(row.name).includes(needle)) return false;
        if (departmentFilter && row.department !== departmentFilter) return false;
        if (statusFilter && row.status !== statusFilter) return false;
        return true;
      });
  }, [candidates, mappingByName, drafts, search, departmentFilter, statusFilter]);

  async function persist(name: string, department: AttendantDepartment, statusValue: AttendantStatus) {
    setNotice(null);
    try {
      await saveMapping({ name, department, status: statusValue });
      setDrafts((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
      setNotice(`Salvo: ${name}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Falha ao salvar.");
    }
  }

  async function persistManual() {
    const name = manualName.trim();
    if (!name) {
      setNotice("Informe o nome do atendente (finished_by).");
      return;
    }
    await persist(name, manualDepartment, manualStatus);
    setManualName("");
  }

  return (
    <div className={styles.attendantsPanel}>
      <div className={styles.sectionIntro}>
        <h3 className={styles.sectionTitle}>Atendentes e departamentos</h3>
        <p className={styles.subtitle}>
          Lista baseada em <code>finished_by</code> dos últimos 12 meses. Associe cada atendente a um
          setor (Enfermagem, Agendamento, Tech, Outros) e marque Ativo/Inativo. Inativos continuam na
          conta por departamento.
        </p>
      </div>

      {status === "loading" ? <p className={styles.subtitle}>Carregando mapeamentos…</p> : null}
      {status === "forbidden" ? <p className={styles.notice}>Acesso restrito a administradores.</p> : null}
      {status === "error" ? <p className={styles.notice}>{error ?? "Não foi possível carregar."}</p> : null}
      {notice ? <p className={styles.subtitle}>{notice}</p> : null}
      {status === "ready" && candidatesLoading ? (
        <p className={styles.subtitle}>Buscando finished_by no Databricks (últimos 12 meses)…</p>
      ) : null}
      {status === "ready" && candidatesError ? (
        <p className={styles.notice}>
          Não foi possível carregar finished_by agora: {candidatesError}. Você ainda pode cadastrar
          nomes manualmente abaixo.
        </p>
      ) : null}

      {status === "ready" ? (
        <>
          <div className={styles.attendantsToolbar}>
            <input
              className={styles.attendantsSearch}
              type="text"
              placeholder="Adicionar finished_by manualmente…"
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
            />
            <select
              className={styles.attendantsSelect}
              value={manualDepartment}
              onChange={(event) => setManualDepartment(event.target.value as AttendantDepartment)}
              aria-label="Departamento do novo atendente"
            >
              {ATTENDANT_DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
            <select
              className={styles.attendantsSelect}
              value={manualStatus}
              onChange={(event) => setManualStatus(event.target.value as AttendantStatus)}
              aria-label="Status do novo atendente"
            >
              <option value="Ativo">Ativo</option>
              <option value="Inativo">Inativo</option>
            </select>
            <button type="button" className={styles.primaryBtn} onClick={() => void persistManual()}>
              Adicionar
            </button>
          </div>

          <div className={styles.attendantsToolbar}>
            <input
              className={styles.attendantsSearch}
              type="search"
              placeholder="Buscar atendente…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className={styles.attendantsSelect}
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value as "" | AttendantDepartment)}
              aria-label="Filtrar departamento"
            >
              <option value="">Todos os setores</option>
              {(departments.length ? departments : ATTENDANT_DEPARTMENTS).map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
            <select
              className={styles.attendantsSelect}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "" | AttendantStatus)}
              aria-label="Filtrar status"
            >
              <option value="">Ativos e inativos</option>
              <option value="Ativo">Ativo</option>
              <option value="Inativo">Inativo</option>
            </select>
            <button type="button" className={styles.secondaryBtn} onClick={reload}>
              Atualizar lista
            </button>
          </div>

          <div className={styles.attendantsMeta}>
            {rows.length} atendente{rows.length === 1 ? "" : "s"} · {mappings.length} mapeado
            {mappings.length === 1 ? "" : "s"}
            {candidatesLoading ? " · sincronizando Databricks…" : ""}
          </div>

          <div className={styles.attendantsTableWrap}>
            <table className={styles.attendantsTable}>
              <thead>
                <tr>
                  <th>Atendente</th>
                  <th>Sessões</th>
                  <th>Última</th>
                  <th>Departamento</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const dirty =
                    Boolean(drafts[row.name]) ||
                    !row.mapped;
                  return (
                    <tr key={row.name}>
                      <td>
                        <div className={styles.attendantName}>{row.name}</div>
                        {!row.mapped ? <span className={styles.attendantBadge}>sem mapa</span> : null}
                      </td>
                      <td>{row.sessions.toLocaleString("pt-BR")}</td>
                      <td>{row.lastSeen || "—"}</td>
                      <td>
                        <select
                          className={styles.attendantsSelect}
                          value={row.department}
                          onChange={(event) => {
                            const department = event.target.value as AttendantDepartment;
                            setDrafts((current) => ({
                              ...current,
                              [row.name]: { department, status: row.status },
                            }));
                          }}
                        >
                          {ATTENDANT_DEPARTMENTS.map((department) => (
                            <option key={department} value={department}>
                              {department}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className={styles.attendantsSelect}
                          value={row.status}
                          onChange={(event) => {
                            const nextStatus = event.target.value as AttendantStatus;
                            setDrafts((current) => ({
                              ...current,
                              [row.name]: { department: row.department, status: nextStatus },
                            }));
                          }}
                        >
                          <option value="Ativo">Ativo</option>
                          <option value="Inativo">Inativo</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          disabled={saving === row.name || !dirty}
                          onClick={() => void persist(row.name, row.department, row.status)}
                        >
                          {saving === row.name ? "Salvando…" : "Salvar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={6} className={styles.subtitle}>
                      {candidatesLoading
                        ? "Aguardando finished_by do Databricks…"
                        : "Nenhum atendente encontrado. Use o campo de adicionar manualmente ou atualize a lista."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
