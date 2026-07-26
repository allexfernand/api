"use client";

// Coordenador da Sinistralidade 360.
// Com a flag longitudinal ligada, renderiza a experiência 1.1.0 (resumo
// executivo aberto + blocos temáticos com carregamento sob demanda).
// Com a flag desligada, preserva a experiência 1.0.0 (LegacyView).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./SinistralidadeV2Tab.module.css";
import { AnalyticsHeader } from "./components/AnalyticsHeader";
import { BlockState } from "./components/BlockState";
import { CompanyBenchmark } from "./components/CompanyBenchmark";
import { ConcentrationAnalysis } from "./components/ConcentrationAnalysis";
import { CoverageNotice } from "./components/CoverageNotice";
import { EventMixChart } from "./components/EventMixChart";
import { ExecutiveKpis } from "./components/ExecutiveKpis";
import { FamilyTimelineBlock, CareTimelineBlock } from "./components/FamilyCareAnalysis";
import { HospitalizationAnalysis } from "./components/HospitalizationAnalysis";
import { LegacyView } from "./components/LegacyView";
import { MonthlyEvolutionChart } from "./components/MonthlyEvolutionChart";
import { ProcedureAnalysis } from "./components/ProcedureAnalysis";
import { ProviderAnalysis } from "./components/ProviderAnalysis";
import { PsItemAnalysis } from "./components/PsItemAnalysis";
import { TopUsersTable, type RankingBy } from "./components/TopUsersTable";
import { UserDetailDrawer } from "./components/UserDetailDrawer";
import { useSinistralidadeFilters } from "./hooks/useSinistralidadeFilters";
import { scopeUrl, useSinistralidadeScope } from "./hooks/useSinistralidadeScope";
import type {
  BenchmarkData,
  CareTimelineData,
  Company,
  ConcentrationData,
  EventMixData,
  FamilyTimelineData,
  Features,
  HospitalizationTrendsData,
  ProcedureTrendsData,
  ProviderTrendsData,
  PsTrendsData,
  TimelineData,
  TopUsersData,
} from "./types";
import { monthLabel } from "./types";

export function SinistralidadeV2Tab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [features, setFeatures] = useState<Features | null>(null);
  const [metadataError, setMetadataError] = useState("");
  const [loading, setLoading] = useState(true);
  const { filters, update, windowOptions } = useSinistralidadeFilters();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sinistralidade/v2?scope=metadata", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error || `Falha ${response.status}`);
        const available = (body.companies ?? []) as Company[];
        setCompanies(available);
        setFeatures((body.features ?? null) as Features | null);
        const defaultCompany = available.reduce<Company | null>((largest, company) =>
          !largest || company.observed_rows > largest.observed_rows ? company : largest, null);
        if (defaultCompany && !available.some((company) => company.company_key === filters.companyKey)) {
          update({ companyKey: defaultCompany.company_key });
        }
      })
      .catch((cause) => !cancelled && setMetadataError(cause instanceof Error ? cause.message : "Falha ao carregar empresas."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section id="tab-sinistralidade-v2" className={`tab-content ${styles.root}`}>
      {metadataError ? <div className={styles.error}><strong>Não foi possível carregar a visão.</strong><span>{metadataError}</span></div> : null}
      {loading ? <div className={styles.empty}>Preparando a visão multiempresa…</div> : null}
      {!loading && !companies.length && !metadataError ? (
        <div className={styles.empty}><strong>Nenhuma empresa liberada.</strong><span>O usuário atual não possui escopo de sinistralidade.</span></div>
      ) : null}
      {!loading && companies.length ? (
        features?.longitudinal ? (
          <LongitudinalExperience
            companies={companies}
            features={features}
            filters={filters}
            update={update}
            windowOptions={windowOptions}
          />
        ) : (
          <LegacyView
            companies={companies}
            companyKey={filters.companyKey || companies[0].company_key}
            onCompanyChange={(companyKey) => update({ companyKey })}
          />
        )
      ) : null}
    </section>
  );
}

function LongitudinalExperience({
  companies,
  features,
  filters,
  update,
  windowOptions,
}: {
  companies: Company[];
  features: Features;
  filters: ReturnType<typeof useSinistralidadeFilters>["filters"];
  update: ReturnType<typeof useSinistralidadeFilters>["update"];
  windowOptions: ReturnType<typeof useSinistralidadeFilters>["windowOptions"];
}) {
  const [rankingBy, setRankingBy] = useState<RankingBy>("cost");
  const [limit, setLimit] = useState<10 | 20>(10);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  // Meses disponíveis (para o seletor de mês final) vêm da visão mensal 1.0.0.
  const overview = useSinistralidadeScope<{ month: string }[]>(
    filters.companyKey ? `/api/sinistralidade/v2?scope=overview&company_key=${filters.companyKey}&include_partial=true` : null,
  );
  const availableMonths = useMemo(
    () => (overview.data ?? []).map((entry) => entry.month),
    [overview.data],
  );
  useEffect(() => {
    const latest = availableMonths.at(-1);
    if (latest && (!filters.endMonth || !availableMonths.includes(filters.endMonth))) {
      update({ endMonth: latest });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableMonths]);

  const ready = Boolean(filters.companyKey && filters.endMonth);
  const baseParams = {
    company_key: filters.companyKey,
    end_month: filters.endMonth,
    window_months: filters.windowMonths,
    include_partial: filters.includePartial,
  };

  const timeline = useSinistralidadeScope<TimelineData>(ready ? scopeUrl("timeline", baseParams) : null);
  const eventMix = useSinistralidadeScope<EventMixData>(ready ? scopeUrl("event-mix", baseParams) : null);

  const periodLabel = timeline.envelope
    ? `${timeline.envelope.effective_period.start_month ? monthLabel(timeline.envelope.effective_period.start_month) : "—"} a ${timeline.envelope.effective_period.end_month ? monthLabel(timeline.envelope.effective_period.end_month) : "—"}`
    : "janela selecionada";

  const navSections: { id: string; label: string; icon: string }[] = [
    { id: "sin-executivo", label: "Resumo executivo", icon: "fa-chart-line" },
    { id: "sin-top", label: "Beneficiários", icon: "fa-users" },
    { id: "sin-procedimentos", label: "Procedimentos", icon: "fa-stethoscope" },
    { id: "sin-internacoes", label: "Internações", icon: "fa-hospital" },
    { id: "sin-prestadores", label: "Prestadores", icon: "fa-building" },
    { id: "sin-concentracao", label: "Concentração", icon: "fa-layer-group" },
    { id: "sin-empresas", label: "Benchmark", icon: "fa-scale-balanced" },
    { id: "sin-familia", label: "Família e coordenação", icon: "fa-people-roof" },
    { id: "sin-ps360", label: "Pronto-socorro", icon: "fa-truck-medical" },
  ];

  return (
    <>
      <AnalyticsHeader
        companies={companies}
        filters={filters}
        windowOptions={windowOptions}
        availableMonths={availableMonths}
        envelope={timeline.envelope}
        onChange={(patch) => update(patch)}
      />
      <CoverageNotice envelope={timeline.envelope} />

      <nav className={styles.anchorNav} aria-label="Seções da análise">
        {navSections.map((section) => (
          <a key={section.id} href={`#${section.id}`}><i className={`fa-solid ${section.icon}`} aria-hidden="true" />{section.label}</a>
        ))}
      </nav>

      <section className={styles.section} id="sin-executivo">
        <div className={styles.sectionHeading}>
          <div><span>Resumo executivo</span><h2>Evolução da janela de {filters.windowMonths} meses</h2></div>
          <p>Todos os valores reconciliam com a Gold v2; meses sem cobertura não viram zero.</p>
        </div>
        <BlockState result={timeline} emptyMessage="Sem meses com dados na janela selecionada.">
          {(data) => (
            <>
              <ExecutiveKpis kpis={data.kpis} />
              <MonthlyEvolutionChart data={data} periodLabel={periodLabel} />
            </>
          )}
        </BlockState>
        <BlockState result={eventMix} emptyMessage="Sem composição por evento na janela.">
          {(data) => <EventMixChart data={data} periodLabel={periodLabel} />}
        </BlockState>
      </section>

      <ThematicSection id="sin-top" kicker="Beneficiários" title="Maiores utilizantes e gastadores" defaultOpen>
        {features.individual_ranking ? (
          <TopUsersBlock
            filters={filters}
            rankingBy={rankingBy}
            limit={limit}
            onRankingByChange={setRankingBy}
            onLimitChange={setLimit}
            onSelect={setSelectedUser}
            canOpenDetail={features.individual_detail}
            ready={ready}
          />
        ) : (
          <div className={styles.blockBlocked}>
            <strong>Ranking individual bloqueado para o seu perfil.</strong>
            <span>Exige permissão específica de ranking individual mascarado, concedida por usuário.</span>
          </div>
        )}
      </ThematicSection>

      <ThematicSection id="sin-procedimentos" kicker="Uso assistencial" title="Serviços e procedimentos">
        <LazyScope<ProcedureTrendsData>
          url={ready ? scopeUrl("procedure-trends", { ...baseParams, limit: 10 }) : null}
          emptyMessage="Sem procedimentos na janela."
        >
          {(data) => <ProcedureAnalysis data={data} periodLabel={periodLabel} />}
        </LazyScope>
      </ThematicSection>

      <ThematicSection id="sin-internacoes" kicker="Severidade" title="Internações e saúde mental">
        <LazyScope<HospitalizationTrendsData>
          url={ready ? scopeUrl("hospitalization-trends", baseParams) : null}
          emptyMessage="Sem episódios de internação na janela."
        >
          {(data) => <HospitalizationAnalysis data={data} periodLabel={periodLabel} />}
        </LazyScope>
      </ThematicSection>

      <ThematicSection id="sin-prestadores" kicker="Rede" title="Prestadores e rede/reembolso">
        <LazyScope<ProviderTrendsData>
          url={ready ? scopeUrl("provider-trends", { ...baseParams, limit: 20 }) : null}
          emptyMessage="Sem prestadores na janela."
        >
          {(data) => <ProviderAnalysis data={data} periodLabel={periodLabel} />}
        </LazyScope>
      </ThematicSection>

      <ThematicSection id="sin-concentracao" kicker="Concentração" title="Concentração do custo">
        <LazyScope<ConcentrationData>
          url={ready ? scopeUrl("concentration", baseParams) : null}
          emptyMessage="Sem dados de concentração na janela."
        >
          {(data) => <ConcentrationAnalysis data={data} periodLabel={periodLabel} />}
        </LazyScope>
      </ThematicSection>

      <ThematicSection id="sin-empresas" kicker="Benchmark" title="Comparação entre empresas">
        {features.company_benchmark ? (
          <LazyScope<BenchmarkData>
            url={filters.endMonth ? scopeUrl("company-benchmark", { end_month: filters.endMonth, window_months: filters.windowMonths, include_partial: filters.includePartial }) : null}
            emptyMessage="Sem empresas comparáveis no seu escopo."
          >
            {(data) => <CompanyBenchmark data={data} />}
          </LazyScope>
        ) : (
          <div className={styles.blockBlocked}>
            <strong>Benchmark bloqueado.</strong>
            <span>Depende da homologação de uma segunda empresa real e da flag SINISTRALIDADE_360_COMPANY_BENCHMARK_ENABLED.</span>
          </div>
        )}
      </ThematicSection>

      <ThematicSection id="sin-familia" kicker="População" title="Família e coordenação">
        <LazyScope<FamilyTimelineData>
          url={ready ? scopeUrl("family-timeline", { company_key: filters.companyKey, end_month: filters.endMonth, window_months: filters.windowMonths, include_partial: filters.includePartial }) : null}
          emptyMessage="Sem famílias com entrada homologada."
        >
          {(data) => <FamilyTimelineBlock data={data} />}
        </LazyScope>
        <LazyScope<CareTimelineData>
          url={ready ? scopeUrl("care-timeline", baseParams) : null}
          emptyMessage="Sem meses de coordenação na janela."
        >
          {(data) => <CareTimelineBlock data={data} periodLabel={periodLabel} />}
        </LazyScope>
      </ThematicSection>

      <ThematicSection id="sin-ps360" kicker="Urgência" title="Pronto-socorro ao longo do tempo">
        <LazyScope<PsTrendsData>
          url={ready ? scopeUrl("ps-trends", { ...baseParams, limit: 20 }) : null}
          emptyMessage="Sem itens de pronto-socorro na janela."
        >
          {(data) => <PsItemAnalysis data={data} periodLabel={periodLabel} />}
        </LazyScope>
      </ThematicSection>

      <UserDetailDrawer entityKey={selectedUser} filters={filters} onClose={() => setSelectedUser(null)} />
    </>
  );
}

function TopUsersBlock({
  filters,
  rankingBy,
  limit,
  onRankingByChange,
  onLimitChange,
  onSelect,
  canOpenDetail,
  ready,
}: {
  filters: ReturnType<typeof useSinistralidadeFilters>["filters"];
  rankingBy: RankingBy;
  limit: 10 | 20;
  onRankingByChange: (value: RankingBy) => void;
  onLimitChange: (value: 10 | 20) => void;
  onSelect: (entityKey: string) => void;
  canOpenDetail: boolean;
  ready: boolean;
}) {
  const result = useSinistralidadeScope<TopUsersData>(
    ready
      ? scopeUrl("top-users-window", {
          company_key: filters.companyKey,
          end_month: filters.endMonth,
          window_months: filters.windowMonths,
          include_partial: filters.includePartial,
          ranking_by: rankingBy,
          limit,
        })
      : null,
  );
  return (
    <BlockState result={result} emptyMessage="Sem beneficiários com consumo na janela.">
      {(data) => (
        <TopUsersTable
          data={data}
          rankingBy={rankingBy}
          limit={limit}
          onRankingByChange={onRankingByChange}
          onLimitChange={onLimitChange}
          onSelect={onSelect}
          canOpenDetail={canOpenDetail}
        />
      )}
    </BlockState>
  );
}

// Bloco temático sempre visível, com navegação por âncoras. O conteúdo (e as
// consultas) só montam quando a seção se aproxima da viewport — mantém a
// progressive disclosure do plano §10.5 sem exigir cliques em acordeões.
function ThematicSection({
  id,
  kicker,
  title,
  defaultOpen = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(defaultOpen);
  const anchor = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (mounted) return;
    const node = anchor.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      const fallback = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(fallback);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  return (
    <section className={styles.section} id={id} ref={anchor}>
      <div className={styles.sectionHeading}>
        <div>
          <span>{kicker}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {mounted ? children : <div className={styles.blockLoading} role="status">Preparando esta seção…</div>}
    </section>
  );
}

function LazyScope<T>({
  url,
  emptyMessage,
  children,
}: {
  url: string | null;
  emptyMessage: string;
  children: (data: T) => ReactNode;
}) {
  const result = useSinistralidadeScope<T>(url);
  return (
    <BlockState result={result} emptyMessage={emptyMessage}>
      {children}
    </BlockState>
  );
}
