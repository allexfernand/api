"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./SinistralidadeV2Tab.module.css";

type Source = { contract_version: string; period_status: "closed" | "partial" | "unknown"; warning: string | null };
type Company = { company_key: string; name: string; operator: string; last_observed_date: string; observed_rows: number };
type MonthRow = { month: string; billing_lines: number; service_quantity: number; utilizers: number; utilizing_families: number; gross_cost: number; company_cost_share: number; eligible_lives: number | null; cost_per_eligible_life: number | null; freshness: string };
type TopRow = { entity_type: string; entity_key: string; label: string; billing_lines: number; service_quantity: number; gross_cost: number; primary_event?: string | null; cost_rank: number };
type MentalRow = { mental_health: boolean; hospitalization_episodes: number; utilizers: number; total_cost: number; average_episode_cost: number; median_duration_days: number };
type BimesterRow = { entity_type: string; entity_key: string; gross_cost: number; billing_lines: number; service_quantity: number; cost_rank: number };
type FamilyRow = { phase: "before" | "after"; families: number; billing_lines: number; service_quantity: number; gross_cost: number; primary_event: string };
type YearRow = { year: number; claims: number; items: number; gross_cost: number; observed_months: number; closed_months: number; publication_status: string };
type PsRow = { procedure: string; macrogroup: string; episodes: number; billing_lines: number; service_quantity: number; gross_cost: number };
type CareRow = { used_plan: boolean; had_care_coordination: boolean; eligible_people: number; gross_cost: number; status: string };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const moneyFull = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Falha ${response.status}`);
  return body as T;
}

function monthLabel(value: string) {
  if (!value) return "—";
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, 1))).replace(" de ", "/");
}

function delta(current: number, previous?: number) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function Delta({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className={styles.neutral}>sem base comparável</span>;
  const favorable = inverse ? value <= 0 : value >= 0;
  return <span className={favorable ? styles.positive : styles.negative}>{value >= 0 ? "↑" : "↓"} {percent.format(Math.abs(value))}% vs. mês anterior</span>;
}

export function SinistralidadeV2Tab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyKey, setCompanyKey] = useState("");
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [month, setMonth] = useState("");
  const [top, setTop] = useState<TopRow[]>([]);
  const [previousTop, setPreviousTop] = useState<TopRow[]>([]);
  const [mental, setMental] = useState<MentalRow[]>([]);
  const [bimester, setBimester] = useState<BimesterRow[]>([]);
  const [family, setFamily] = useState<FamilyRow[]>([]);
  const [yearComparison, setYearComparison] = useState<YearRow[]>([]);
  const [psItems, setPsItems] = useState<PsRow[]>([]);
  const [care, setCare] = useState<CareRow[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getJson<{ companies: Company[] }>("/api/sinistralidade/v2?scope=metadata")
      .then(({ companies: available }) => {
        if (cancelled) return;
        setCompanies(available);
        const defaultCompany = available.reduce<Company | null>((largest, company) =>
          !largest || company.observed_rows > largest.observed_rows ? company : largest, null);
        setCompanyKey(defaultCompany?.company_key || "");
      })
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : "Falha ao carregar empresas."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!companyKey) return;
    let cancelled = false;
    getJson<{ source: Source; data: MonthRow[] }>(`/api/sinistralidade/v2?scope=overview&company_key=${companyKey}&include_partial=true`)
      .then((overview) => {
        if (cancelled) return;
        setError("");
        setMonths(overview.data);
        setSource(overview.source);
        const latest = overview.data.at(-1)?.month || "";
        setMonth((current) => current && overview.data.some((item) => item.month === current) ? current : latest);
      })
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : "Falha ao carregar indicadores."));
    return () => { cancelled = true; };
  }, [companyKey]);

  const monthIndex = months.findIndex((item) => item.month === month);
  const previousMonth = monthIndex > 0 ? months[monthIndex - 1]?.month : "";

  useEffect(() => {
    if (!companyKey || !month) return;
    let cancelled = false;
    const [year, monthNumber] = month.split("-").map(Number);
    const bimesterKey = `${year}-B${Math.ceil(monthNumber / 2)}`;
    const base = `/api/sinistralidade/v2?company_key=${companyKey}&include_partial=true`;
    Promise.all([
      getJson<{ source: Source; data: TopRow[] }>(`${base}&scope=top10&month=${month}`),
      previousMonth ? getJson<{ data: TopRow[] }>(`${base}&scope=top10&month=${previousMonth}`) : Promise.resolve({ data: [] as TopRow[] }),
      getJson<{ data: MentalRow[] }>(`${base}&scope=mental-health&month=${month}`),
      getJson<{ data: BimesterRow[] }>(`${base}&scope=bimester&bimester=${bimesterKey}`),
      getJson<{ data: FamilyRow[] }>(`${base}&scope=family-before-after`),
      getJson<{ data: YearRow[] }>(`${base}&scope=year-over-year&year=${year}`),
      getJson<{ data: PsRow[] }>(`${base}&scope=ps-package&month=${month}`),
      getJson<{ data: CareRow[] }>(`${base}&scope=care-coordination`),
    ]).then(([topResult, priorResult, mentalResult, bimesterResult, familyResult, yearResult, psResult, careResult]) => {
      if (cancelled) return;
      setSource(topResult.source);
      setTop(topResult.data);
      setPreviousTop(priorResult.data);
      setMental(mentalResult.data);
      setBimester(bimesterResult.data);
      setFamily(familyResult.data);
      setYearComparison(yearResult.data);
      setPsItems(psResult.data);
      setCare(careResult.data);
      setError("");
    }).catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : "Falha ao carregar o detalhamento."));
    return () => { cancelled = true; };
  }, [companyKey, month, previousMonth]);

  const selected = useMemo(() => months.find((item) => item.month === month), [months, month]);
  const previous = useMemo(() => months.find((item) => item.month === previousMonth), [months, previousMonth]);
  const selectedCompany = companies.find((item) => item.company_key === companyKey);
  const people = top.filter((item) => item.entity_type === "person").sort((a, b) => a.cost_rank - b.cost_rank).slice(0, 10);
  const procedures = top.filter((item) => item.entity_type === "procedure").sort((a, b) => a.cost_rank - b.cost_rank).slice(0, 10);
  const priorPeople = new Set(previousTop.filter((item) => item.entity_type === "person").map((item) => item.entity_key));
  const recurringPeople = people.filter((item) => priorPeople.has(item.entity_key)).length;
  const trend = months.slice(-12);
  const maxTrendCost = Math.max(...trend.map((item) => item.gross_cost), 1);
  const before = family.find((item) => item.phase === "before");
  const after = family.find((item) => item.phase === "after");
  const mentalHealth = mental.find((item) => item.mental_health);
  const otherAdmissions = mental.find((item) => !item.mental_health);
  const peopleBimester = bimester.filter((item) => item.entity_type === "person" && item.cost_rank <= 10).slice(0, 5);
  const procedureBimester = bimester.filter((item) => item.entity_type === "procedure" && item.cost_rank <= 10).slice(0, 5);

  const careCell = (usedPlan: boolean, coordinated: boolean) => care
    .filter((row) => row.used_plan === usedPlan && row.had_care_coordination === coordinated)
    .reduce((total, row) => total + row.eligible_people, 0);
  const careTotal = care.reduce((total, row) => total + row.eligible_people, 0);

  return (
    <section id="tab-sinistralidade-v2" className={`tab-content ${styles.root}`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><span /> Inteligência assistencial multiempresa</div>
          <h1>Sinistralidade <strong>360</strong></h1>
          <p>Uma leitura executiva de custo, frequência, severidade e coordenação — do consolidado ao episódio.</p>
        </div>
        <div className={styles.controls}>
          <label>Empresa
            <select value={companyKey} onChange={(event) => setCompanyKey(event.target.value)}>
              {companies.map((company) => <option key={company.company_key} value={company.company_key}>{company.name}</option>)}
            </select>
          </label>
          <label>Competência observada
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {months.map((item) => <option key={item.month} value={item.month}>{monthLabel(item.month)}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.heroMeta}>
          <span className={source?.period_status === "closed" ? styles.closed : styles.pending}>{source?.period_status === "closed" ? "Mês fechado" : "Dado observado · não fechado"}</span>
          <span>{selectedCompany?.operator || "Operadora não informada"}</span>
          <span>Contrato Gold v{source?.contract_version || "1.0.0"}</span>
        </div>
      </header>

      <nav className={styles.anchorNav} aria-label="Seções da sinistralidade">
        {[['#sin-overview', 'Visão executiva'], ['#sin-rankings', 'Top 10'], ['#sin-population', 'Famílias'], ['#sin-care', 'Coordenação'], ['#sin-ps', 'Pronto-socorro']].map(([href, label]) => <a key={href} href={href}>{label}</a>)}
      </nav>

      {error ? <div className={styles.error}><strong>Não foi possível atualizar a visão.</strong><span>{error}</span></div> : null}
      {loading ? <div className={styles.empty}>Preparando a visão multiempresa…</div> : null}
      {!loading && !companies.length ? <div className={styles.empty}><strong>Nenhuma empresa liberada.</strong><span>O usuário atual não possui escopo de sinistralidade.</span></div> : null}

      {selected ? <>
        <section id="sin-overview" className={styles.section}>
          <SectionHeading kicker="Visão executiva" title={`${selectedCompany?.name || "Empresa"} em ${monthLabel(month)}`} note={source?.warning || "Mês reconciliado e disponível para análise."} />
          <div className={styles.kpiGrid}>
            <Kpi label="Custo assistencial" value={money.format(selected.gross_cost)} deltaValue={delta(selected.gross_cost, previous?.gross_cost)} inverse />
            <Kpi label="Utilizantes" value={number.format(selected.utilizers)} deltaValue={delta(selected.utilizers, previous?.utilizers)} />
            <Kpi label="Serviços realizados" value={number.format(selected.service_quantity)} deltaValue={delta(selected.service_quantity, previous?.service_quantity)} />
            <Kpi label="Famílias utilizantes" value={number.format(selected.utilizing_families)} deltaValue={delta(selected.utilizing_families, previous?.utilizing_families)} />
            <Kpi label="Participação no custo" value={`${percent.format(selected.company_cost_share * 100)}%`} helper="do custo total observado no mês" />
            <Kpi label="Custo por vida elegível" value={selected.cost_per_eligible_life == null ? "Aguardando base" : moneyFull.format(selected.cost_per_eligible_life)} helper={selected.eligible_lives == null ? "snapshot histórico ainda indisponível" : `${number.format(selected.eligible_lives)} vidas elegíveis`} muted={selected.cost_per_eligible_life == null} />
          </div>

          <div className={styles.twoColumns}>
            <article className={`${styles.card} ${styles.trendCard}`}>
              <CardTitle title="Evolução do custo assistencial" subtitle="Últimas 12 competências disponíveis" />
              <div className={styles.trend}>
                {trend.map((row) => <div className={styles.trendColumn} key={row.month} title={`${monthLabel(row.month)}: ${moneyFull.format(row.gross_cost)}`}>
                  <span className={styles.trendValue}>{money.format(row.gross_cost)}</span>
                  <div className={`${styles.trendBar} ${row.month === month ? styles.selectedBar : ""}`} style={{ height: `${Math.max(8, row.gross_cost / maxTrendCost * 150)}px` }} />
                  <span>{row.month.slice(5)}</span>
                </div>)}
              </div>
            </article>
            <article className={styles.card}>
              <CardTitle title="Leitura do bimestre" subtitle={`${monthLabel(previousMonth)} × ${monthLabel(month)}`} />
              <div className={styles.compareRows}>
                <CompareRow label="Custo" previous={previous ? money.format(previous.gross_cost) : "—"} current={money.format(selected.gross_cost)} change={delta(selected.gross_cost, previous?.gross_cost)} inverse />
                <CompareRow label="Utilizantes" previous={previous ? number.format(previous.utilizers) : "—"} current={number.format(selected.utilizers)} change={delta(selected.utilizers, previous?.utilizers)} />
                <CompareRow label="Serviços" previous={previous ? number.format(previous.service_quantity) : "—"} current={number.format(selected.service_quantity)} change={delta(selected.service_quantity, previous?.service_quantity)} />
              </div>
              <div className={styles.insight}><strong>{recurringPeople}/10</strong><span>dos maiores utilizantes do mês também estavam no Top 10 anterior.</span></div>
            </article>
          </div>
        </section>

        <section id="sin-rankings" className={styles.section}>
          <SectionHeading kicker="Concentração" title="Quem e o que mais pressionou o custo" note="Identificações individuais permanecem mascaradas." />
          <div className={styles.twoColumns}>
            <Ranking title="Top 10 utilizantes" rows={people} showEvent />
            <Ranking title="Top 10 procedimentos" rows={procedures} />
          </div>
          <article className={styles.card}>
            <CardTitle title="Lideranças do bimestre" subtitle="Visão acumulada por custo, separando utilizantes e procedimentos" />
            <div className={styles.bimesterGrid}>
              <MiniRanking title="Utilizantes" rows={peopleBimester} labels={top} />
              <MiniRanking title="Procedimentos" rows={procedureBimester} labels={top} />
            </div>
          </article>
        </section>

        <section id="sin-population" className={styles.section}>
          <SectionHeading kicker="População e severidade" title="Famílias e internações antes de virarem tendência" />
          <div className={styles.twoColumns}>
            <article className={styles.card}>
              <CardTitle title="Grupo familiar: antes e depois" subtitle="Janela de seis meses centrada na entrada do titular" />
              <div className={styles.beforeAfter}>
                <Phase label="6 meses antes" row={before} />
                <div className={styles.phaseArrow}>→</div>
                <Phase label="Entrada + 5 meses" row={after} highlight />
              </div>
              {before && after ? <div className={styles.callout}>O custo total <strong>{delta(after.gross_cost, before.gross_cost)! >= 0 ? "subiu" : "caiu"} {percent.format(Math.abs(delta(after.gross_cost, before.gross_cost) || 0))}%</strong> após a entrada, com evento principal <strong>{after.primary_event}</strong>.</div> : null}
            </article>
            <article className={styles.card}>
              <CardTitle title="Internações e saúde mental" subtitle="Saúde mental isolada das demais internações" />
              <div className={styles.mentalGrid}>
                <Mental label="Saúde mental" row={mentalHealth} accent />
                <Mental label="Demais internações" row={otherAdmissions} />
              </div>
            </article>
          </div>
        </section>

        <section id="sin-care" className={styles.section}>
          <SectionHeading kicker="Fatura × coordenação" title="Quem usa o plano e quem está sendo coordenado" note="Snapshot atual de elegibilidade; dependentes sem vínculo ao titular permanecem sinalizados." />
          <article className={styles.card}>
            <div className={styles.careHeader}><CardTitle title="Matriz de alcance assistencial" subtitle={`${number.format(careTotal)} vidas no snapshot disponível`} /><span className={styles.dataBadge}>CPF do titular · match protegido</span></div>
            <div className={styles.matrix}>
              <div className={styles.matrixCorner} />
              <div className={styles.matrixAxis}>Com coordenação</div><div className={styles.matrixAxis}>Sem coordenação</div>
              <div className={styles.matrixAxis}>Usou o plano</div>
              <MatrixCell value={careCell(true, true)} label="Uso acompanhado" tone="good" />
              <MatrixCell value={careCell(true, false)} label="Gap prioritário" tone="risk" />
              <div className={styles.matrixAxis}>Não usou</div>
              <MatrixCell value={careCell(false, true)} label="Prevenção ativa" tone="info" />
              <MatrixCell value={careCell(false, false)} label="Sem alcance" tone="neutral" />
            </div>
            <p className={styles.methodNote}>O snapshot de elegibilidade começou após a última competência de utilização. Por isso, a matriz atual mede alcance de coordenação, mas ainda não deve ser interpretada como comparação histórica completa de uso.</p>
          </article>
        </section>

        <section id="sin-ps" className={styles.section}>
          <SectionHeading kicker="Episódios de pronto-socorro" title="Itens consumidos dentro do pacote de PS" note="Associação por episódio canônico: pessoa, conta, autorização, data e prestador." />
          <article className={styles.card}>
            <div className={styles.psSummary}>
              <div><strong>{number.format(psItems.reduce((total, row) => total + row.episodes, 0))}</strong><span>episódios associados*</span></div>
              <div><strong>{money.format(psItems.reduce((total, row) => total + row.gross_cost, 0))}</strong><span>custo dos itens exibidos</span></div>
              <div><strong>{number.format(psItems.reduce((total, row) => total + row.service_quantity, 0))}</strong><span>serviços nos itens exibidos</span></div>
            </div>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Item associado</th><th>Grupo comercial</th><th>Episódios</th><th>Serviços</th><th>Custo</th></tr></thead><tbody>
              {psItems.slice(0, 12).map((row, index) => <tr key={`${row.procedure}-${index}`}><td><strong>{row.procedure}</strong></td><td>{row.macrogroup}</td><td>{number.format(row.episodes)}</td><td>{number.format(row.service_quantity)}</td><td>{moneyFull.format(row.gross_cost)}</td></tr>)}
            </tbody></table></div>
            <p className={styles.methodNote}>* Um episódio pode conter vários itens; a soma por item não representa episódios únicos globais.</p>
          </article>
        </section>

        <section className={styles.section}>
          <SectionHeading kicker="Comparativo anual" title="Janeiro–junho, ano contra ano" />
          <div className={styles.yearGrid}>
            {yearComparison.map((row) => row.publication_status === "publishable"
              ? <article className={styles.yearCard} key={row.year}><span>{row.year}</span><strong>{money.format(row.gross_cost)}</strong><small>{number.format(row.claims)} linhas · {number.format(row.items)} serviços</small></article>
              : <article className={`${styles.yearCard} ${styles.locked}`} key={row.year}><span>{row.year}</span><strong>Comparativo bloqueado</strong><small>{row.closed_months}/6 meses formalmente fechados</small></article>)}
          </div>
        </section>
      </> : null}
    </section>
  );
}

function SectionHeading({ kicker, title, note }: { kicker: string; title: string; note?: string | null }) {
  return <div className={styles.sectionHeading}><div><span>{kicker}</span><h2>{title}</h2></div>{note ? <p>{note}</p> : null}</div>;
}

function CardTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className={styles.cardTitle}><h3>{title}</h3><p>{subtitle}</p></div>;
}

function Kpi({ label, value, deltaValue, inverse, helper, muted }: { label: string; value: string; deltaValue?: number | null; inverse?: boolean; helper?: string; muted?: boolean }) {
  return <article className={`${styles.kpi} ${muted ? styles.mutedKpi : ""}`}><span>{label}</span><strong>{value}</strong>{deltaValue !== undefined ? <Delta value={deltaValue} inverse={inverse} /> : <small>{helper}</small>}</article>;
}

function CompareRow({ label, previous, current, change, inverse }: { label: string; previous: string; current: string; change: number | null; inverse?: boolean }) {
  return <div className={styles.compareRow}><span>{label}</span><small>{previous}</small><b>→</b><strong>{current}</strong><Delta value={change} inverse={inverse} /></div>;
}

function Ranking({ title, rows, showEvent = false }: { title: string; rows: TopRow[]; showEvent?: boolean }) {
  const max = Math.max(...rows.map((row) => row.gross_cost), 1);
  return <article className={styles.card}><CardTitle title={title} subtitle="Ordenado por custo assistencial no mês" /><div className={styles.ranking}>{rows.map((row, index) => <div className={styles.rankRow} key={row.entity_key}><span className={styles.rankNumber}>{index + 1}</span><div className={styles.rankBody}><div><strong>{row.label}</strong>{showEvent ? <small>{row.primary_event || "Evento não classificado"}</small> : <small>{number.format(row.service_quantity)} serviços</small>}</div><div className={styles.rankTrack}><i style={{ width: `${Math.max(4, row.gross_cost / max * 100)}%` }} /></div></div><b>{money.format(row.gross_cost)}</b></div>)}</div></article>;
}

function MiniRanking({ title, rows, labels }: { title: string; rows: BimesterRow[]; labels: TopRow[] }) {
  const labelFor = (row: BimesterRow) => labels.find((item) => item.entity_key === row.entity_key)?.label || (row.entity_type === "person" ? `Beneficiário ${row.entity_key.slice(0, 8)}` : row.entity_key);
  return <div className={styles.miniRanking}><h4>{title}</h4>{rows.map((row, index) => <div key={row.entity_key}><span>{index + 1}</span><p>{labelFor(row)}</p><strong>{money.format(row.gross_cost)}</strong></div>)}</div>;
}

function Phase({ label, row, highlight }: { label: string; row?: FamilyRow; highlight?: boolean }) {
  return <div className={`${styles.phase} ${highlight ? styles.highlightPhase : ""}`}><span>{label}</span><strong>{row ? money.format(row.gross_cost) : "—"}</strong><small>{row ? `${number.format(row.families)} famílias · ${number.format(row.service_quantity)} serviços` : "Sem base disponível"}</small><em>{row?.primary_event || "Evento não classificado"}</em></div>;
}

function Mental({ label, row, accent }: { label: string; row?: MentalRow; accent?: boolean }) {
  return <div className={`${styles.mental} ${accent ? styles.mentalAccent : ""}`}><span>{label}</span><strong>{number.format(row?.hospitalization_episodes || 0)} episódios</strong><div><small>Custo médio</small><b>{moneyFull.format(row?.average_episode_cost || 0)}</b></div><div><small>Duração mediana</small><b>{number.format(row?.median_duration_days || 0)} dias</b></div></div>;
}

function MatrixCell({ value, label, tone }: { value: number; label: string; tone: "good" | "risk" | "info" | "neutral" }) {
  return <div className={`${styles.matrixCell} ${styles[tone]}`}><strong>{number.format(value)}</strong><span>{label}</span></div>;
}
