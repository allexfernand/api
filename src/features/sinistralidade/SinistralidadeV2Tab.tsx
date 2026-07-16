"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./SinistralidadeV2Tab.module.css";

type Company = { company_key: string; name: string; operator: string; last_observed_date: string };
type MonthRow = { month: string; billing_lines: number; service_quantity: number; utilizers: number; utilizing_families: number; gross_cost: number; company_cost_share: number; eligible_lives: number | null; cost_per_eligible_life: number | null };
type TopRow = { entity_type: string; entity_key: string; label: string; billing_lines: number; service_quantity: number; gross_cost: number; primary_event?: string | null; cost_rank: number };
type MentalRow = { mental_health: boolean; hospitalization_episodes: number; total_cost: number; average_episode_cost: number; median_duration_days: number };
type BimesterRow = { entity_type: string; entity_key: string; gross_cost: number; billing_lines: number; service_quantity: number; cost_rank: number };
type FamilyRow = { phase: "before" | "after"; families: number; billing_lines: number; service_quantity: number; gross_cost: number; primary_event: string };
type YearRow = { year: number; claims: number; items: number; gross_cost: number; observed_months: number; closed_months: number; publication_status: string };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Falha ${response.status}`);
  return body as T;
}

export function SinistralidadeV2Tab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyKey, setCompanyKey] = useState("");
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [month, setMonth] = useState("");
  const [top, setTop] = useState<TopRow[]>([]);
  const [mental, setMental] = useState<MentalRow[]>([]);
  const [bimester, setBimester] = useState<BimesterRow[]>([]);
  const [family, setFamily] = useState<FamilyRow[]>([]);
  const [yearComparison, setYearComparison] = useState<YearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<{ companies: Company[] }>("/api/sinistralidade/v2?scope=metadata")
      .then(({ companies: available }) => {
        setCompanies(available);
        setCompanyKey(available[0]?.company_key || "");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar empresas."))
      .finally(() => setLoading(false));
  }, []);

  const loadOverview = useCallback(async () => {
    if (!companyKey) return;
    setLoading(true);
    try {
      const overview = await getJson<{ data: MonthRow[] }>(`/api/sinistralidade/v2?scope=overview&company_key=${companyKey}&include_partial=true`);
      setError("");
      setMonths(overview.data);
      const latest = overview.data.at(-1)?.month || "";
      setMonth((current) => current && overview.data.some((item) => item.month === current) ? current : latest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar indicadores.");
    } finally { setLoading(false); }
  }, [companyKey]);

  useEffect(() => {
    if (!companyKey) return;
    getJson<{ data: MonthRow[] }>(`/api/sinistralidade/v2?scope=overview&company_key=${companyKey}&include_partial=true`)
      .then((overview) => {
        setError("");
        setMonths(overview.data);
        const latest = overview.data.at(-1)?.month || "";
        setMonth((current) => current && overview.data.some((item) => item.month === current) ? current : latest);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar indicadores."))
      .finally(() => setLoading(false));
  }, [companyKey]);

  useEffect(() => {
    if (!companyKey || !month) return;
    const [year, monthNumber] = month.split("-").map(Number);
    const bimesterKey = `${year}-B${Math.ceil(monthNumber / 2)}`;
    Promise.all([
      getJson<{ data: TopRow[] }>(`/api/sinistralidade/v2?scope=top10&company_key=${companyKey}&month=${month}&include_partial=true`),
      getJson<{ data: MentalRow[] }>(`/api/sinistralidade/v2?scope=mental-health&company_key=${companyKey}&month=${month}&include_partial=true`),
      getJson<{ data: BimesterRow[] }>(`/api/sinistralidade/v2?scope=bimester&company_key=${companyKey}&bimester=${bimesterKey}&include_partial=true`),
      getJson<{ data: FamilyRow[] }>(`/api/sinistralidade/v2?scope=family-before-after&company_key=${companyKey}&include_partial=true`),
      getJson<{ data: YearRow[] }>(`/api/sinistralidade/v2?scope=year-over-year&company_key=${companyKey}&year=${year}&include_partial=true`),
    ]).then(([topResponse, mentalResponse, bimesterResponse, familyResponse, yearResponse]) => {
      setTop(topResponse.data);
      setMental(mentalResponse.data);
      setBimester(bimesterResponse.data);
      setFamily(familyResponse.data);
      setYearComparison(yearResponse.data);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar detalhamento."));
  }, [companyKey, month]);

  const selected = useMemo(() => months.find((item) => item.month === month), [months, month]);
  const people = top.filter((item) => item.entity_type === "person").sort((a, b) => a.cost_rank - b.cost_rank).slice(0, 10);
  const procedures = top.filter((item) => item.entity_type === "procedure").sort((a, b) => a.cost_rank - b.cost_rank).slice(0, 10);

  return (
    <section id="tab-sinistralidade-v2" className={`tab-content ${styles.root}`}>
      <div className={styles.hero}>
        <h1>Sinistralidade multiempresa</h1>
        <p>Custo assistencial, frequência e severidade com contrato v2 e isolamento por empresa.</p>
        <div className={styles.controls}>
          <label>Empresa
            <select value={companyKey} onChange={(event) => setCompanyKey(event.target.value)}>
              {companies.map((company) => <option key={company.company_key} value={company.company_key}>{company.name}</option>)}
            </select>
          </label>
          <label>Mês observado
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {months.map((item) => <option key={item.month} value={item.month}>{item.month}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void loadOverview()}>Atualizar</button>
        </div>
        <div className={styles.status}>
          <span className={styles.badge}>Contrato 1.0.0</span>
          <span className={styles.badge}>Período ainda sem gate formal de fechamento</span>
          <span>“Linhas” e “quantidade de serviços” são métricas diferentes.</span>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
      </div>

      {loading && !selected ? <div className={`${styles.card} ${styles.message}`}>Carregando dados versionados…</div> : null}
      {!loading && !companies.length ? <div className={`${styles.card} ${styles.message}`}>Nenhuma empresa autorizada. Configure os company scopes do usuário.</div> : null}

      {selected ? <>
        <div className={styles.grid}>
          <Metric label="Custo assistencial bruto" value={money.format(selected.gross_cost)} />
          <Metric label="Utilizantes" value={number.format(selected.utilizers)} />
          <Metric label="Linhas de cobrança" value={number.format(selected.billing_lines)} />
          <Metric label="Quantidade de serviços" value={number.format(selected.service_quantity)} />
          <Metric label="Participação no custo do mês" value={`${number.format(selected.company_cost_share * 100)}%`} />
          <Metric label="Custo por vida elegível" value={selected.cost_per_eligible_life == null ? "Aguardando snapshot fechado" : money.format(selected.cost_per_eligible_life)} />
        </div>
        <div className={styles.sections}>
          <Ranking title="Top 10 utilizantes por custo" rows={people} showEvent />
          <Ranking title="Top 10 procedimentos por custo" rows={procedures} />
          <div className={styles.card}>
            <h2>Comparativo bimestral</h2>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Tipo</th><th>Identificação</th><th>Custo</th></tr></thead><tbody>
              {bimester.filter((row) => row.cost_rank <= 10).map((row) => <tr key={`${row.entity_type}-${row.entity_key}`}><td>{row.entity_type === "person" ? "Utilizante" : "Procedimento"}</td><td>{row.entity_type === "person" ? `Beneficiário ${row.entity_key.slice(0, 8)}` : row.entity_key}</td><td>{money.format(row.gross_cost)}</td></tr>)}
            </tbody></table></div>
          </div>
          <div className={styles.card}>
            <h2>Internações e saúde mental</h2>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Recorte</th><th>Episódios</th><th>Custo médio</th></tr></thead><tbody>
              {mental.map((row) => <tr key={String(row.mental_health)}><td>{row.mental_health ? "Saúde mental" : "Demais internações"}</td><td>{number.format(row.hospitalization_episodes)}</td><td>{money.format(row.average_episode_cost)}</td></tr>)}
            </tbody></table></div>
          </div>
          <div className={styles.card}>
            <h2>Grupo familiar: antes e depois da entrada</h2>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Janela</th><th>Famílias</th><th>Evento principal</th><th>Custo</th></tr></thead><tbody>
              {family.map((row) => <tr key={row.phase}><td>{row.phase === "before" ? "6 meses antes" : "Entrada + 5 meses"}</td><td>{number.format(row.families)}</td><td>{row.primary_event}</td><td>{money.format(row.gross_cost)}</td></tr>)}
            </tbody></table></div>
          </div>
          <div className={styles.card}>
            <h2>Comparativo janeiro–junho</h2>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Ano</th><th>Sinistros</th><th>Itens</th><th>Custo</th><th>Publicação</th></tr></thead><tbody>
              {yearComparison.map((row) => <tr key={row.year}><td>{row.year}</td><td>{number.format(row.claims)}</td><td>{number.format(row.items)}</td><td>{money.format(row.gross_cost)}</td><td>{row.publication_status === "publishable" ? "Liberado" : `Bloqueado (${row.closed_months}/6 meses fechados)`}</td></tr>)}
            </tbody></table></div>
          </div>
          <div className={styles.card}>
            <h2>Leitura metodológica</h2>
            <p>Utilizante é quem teve uso no período; não é vida elegível. O custo por vida será liberado após o primeiro fechamento do snapshot mensal de elegibilidade.</p>
            <p>Doença principal não é exibida enquanto a cobertura de CID for insuficiente. O evento principal é usado como classificação operacional.</p>
          </div>
        </div>
      </> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={styles.card}><div className={styles.metricLabel}>{label}</div><div className={styles.metricValue}>{value}</div></div>;
}

function Ranking({ title, rows, showEvent = false }: { title: string; rows: TopRow[]; showEvent?: boolean }) {
  return <div className={styles.card}><h2>{title}</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>#</th><th>Identificação</th>{showEvent ? <th>Evento principal</th> : null}<th>Custo</th></tr></thead><tbody>
    {rows.map((row, index) => <tr key={row.entity_key}><td>{index + 1}</td><td>{row.label}</td>{showEvent ? <td>{row.primary_event || "Sem classificação"}</td> : null}<td>{money.format(row.gross_cost)}</td></tr>)}
  </tbody></table></div></div>;
}
