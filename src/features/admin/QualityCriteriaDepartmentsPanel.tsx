"use client";

import { useMemo, useState } from "react";
import styles from "./SettingsTab.module.css";
import { useQualityCriteriaDepartments } from "./hooks/useQualityCriteriaDepartments";
import {
  QUALITY_CRITERIA_DEPARTMENTS,
  type QualityCriteriaDepartment,
} from "../../contracts/quality-criteria-departments";

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/,/g, ".");
}

export function QualityCriteriaDepartmentsPanel() {
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
  } = useQualityCriteriaDepartments();
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<"" | QualityCriteriaDepartment>("");
  const [drafts, setDrafts] = useState<Record<string, QualityCriteriaDepartment[]>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const mappingById = useMemo(() => {
    const map = new Map<string, (typeof mappings)[number]>();
    for (const item of mappings) map.set(normalizeKey(item.criterio_id), item);
    return map;
  }, [mappings]);

  const rows = useMemo(() => {
    const needle = normalizeKey(search);
    return candidates
      .map((candidate) => {
        const mapped = mappingById.get(normalizeKey(candidate.criterio_id));
        const draft = drafts[candidate.criterio_id];
        const rowDepartments = draft || mapped?.departments || [];
        return {
          criterio_id: candidate.criterio_id,
          sub_criterio: candidate.sub_criterio || mapped?.sub_criterio || candidate.criterio_id,
          evaluations: candidate.evaluations || 0,
          departments: rowDepartments,
          mapped: Boolean(mapped),
        };
      })
      .filter((row) => {
        if (
          needle &&
          !normalizeKey(`${row.criterio_id} ${row.sub_criterio}`).includes(needle)
        ) {
          return false;
        }
        if (departmentFilter && !row.departments.includes(departmentFilter)) return false;
        return true;
      });
  }, [candidates, mappingById, drafts, search, departmentFilter]);

  function toggleDepartment(criterioId: string, department: QualityCriteriaDepartment) {
    const mapped = mappingById.get(normalizeKey(criterioId));
    const current = drafts[criterioId] || mapped?.departments || [];
    const next = current.includes(department)
      ? current.filter((item) => item !== department)
      : [...current, department];
    setDrafts((state) => ({ ...state, [criterioId]: next }));
  }

  async function persist(criterioId: string, subCriterio: string) {
    setNotice(null);
    const mapped = mappingById.get(normalizeKey(criterioId));
    const departmentsValue = drafts[criterioId] || mapped?.departments || [];
    try {
      await saveMapping({
        criterio_id: criterioId,
        sub_criterio: subCriterio,
        departments: departmentsValue,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[criterioId];
        return next;
      });
      setNotice(`Salvo: ${criterioId}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Falha ao salvar.");
    }
  }

  return (
    <div className={styles.attendantsPanel}>
      <div className={styles.sectionIntro}>
        <h3 className={styles.sectionTitle}>Critérios × departamentos</h3>
        <p className={styles.subtitle}>
          Associe cada <strong>subcritério</strong> aos departamentos em que ele é avaliado. Na
          Qualidade Estratégica, o filtro de departamento calcula score, distribuição e ranking
          somente com os subcritérios marcados aqui. Um subcritério pode valer para vários
          departamentos (ex.: Agendamento avalia menos critérios que Enfermagem).
        </p>
      </div>

      {status === "loading" ? <p className={styles.subtitle}>Carregando mapeamentos…</p> : null}
      {status === "forbidden" ? <p className={styles.notice}>Acesso restrito a administradores.</p> : null}
      {status === "error" ? <p className={styles.notice}>{error ?? "Não foi possível carregar."}</p> : null}
      {notice ? <p className={styles.subtitle}>{notice}</p> : null}
      {status === "ready" && candidatesLoading ? (
        <p className={styles.subtitle}>Buscando subcritérios no Databricks…</p>
      ) : null}
      {status === "ready" && candidatesError ? (
        <p className={styles.notice}>
          Não foi possível carregar o catálogo agora: {candidatesError}. Mapeamentos já salvos
          continuam editáveis.
        </p>
      ) : null}

      {status === "ready" ? (
        <>
          <div className={styles.attendantsToolbar}>
            <input
              className={styles.attendantsSearch}
              placeholder="Buscar por id ou nome do subcritério…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className={styles.attendantsSelect}
              value={departmentFilter}
              onChange={(event) =>
                setDepartmentFilter((event.target.value || "") as "" | QualityCriteriaDepartment)
              }
            >
              <option value="">Todos os departamentos</option>
              {(departments.length ? departments : QUALITY_CRITERIA_DEPARTMENTS).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button type="button" className={styles.secondaryBtn} onClick={reload}>
              Recarregar
            </button>
          </div>

          <div className={styles.attendantsMeta}>
            {rows.length} subcritérios · {mappings.length} com mapeamento salvo
          </div>

          <div className={styles.attendantsTableWrap}>
            <table className={styles.attendantsTable}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Subcritério</th>
                  <th>Departamentos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const dirty =
                    JSON.stringify([...(drafts[row.criterio_id] || row.departments)].sort()) !==
                    JSON.stringify([...(mappingById.get(normalizeKey(row.criterio_id))?.departments || [])].sort());
                  return (
                    <tr key={row.criterio_id}>
                      <td>
                        <code>{row.criterio_id}</code>
                      </td>
                      <td>
                        <div>{row.sub_criterio}</div>
                        <div className={styles.subtitle} style={{ margin: 0 }}>
                          {row.evaluations.toLocaleString("pt-BR")} avaliações
                          {row.mapped ? "" : " · sem mapa"}
                        </div>
                      </td>
                      <td>
                        <div className={styles.criteriaDeptChecks}>
                          {QUALITY_CRITERIA_DEPARTMENTS.map((department) => {
                            const checked = row.departments.includes(department);
                            return (
                              <label key={department} className={styles.criteriaDeptCheck}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleDepartment(row.criterio_id, department)}
                                />
                                {department}
                              </label>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          disabled={!dirty || saving === row.criterio_id}
                          onClick={() => persist(row.criterio_id, row.sub_criterio)}
                        >
                          {saving === row.criterio_id ? "Salvando…" : "Salvar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={4}>Nenhum subcritério encontrado com os filtros atuais.</td>
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
