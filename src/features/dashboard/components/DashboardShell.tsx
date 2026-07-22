"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { apiRequest } from "../../../lib/api/client";
import { authResponseSchema } from "../../../contracts/auth";

type LegacyDashboardApi = Record<string, (...args: unknown[]) => unknown>;

declare global {
  interface Window {
    SanusDashboard?: LegacyDashboardApi;
  }
}

const navSections = [
  {
    label: "Visão Geral",
    items: [
      ["demografica", "Análise Demográfica", "fa-chart-pie"],
      ["agendamentos", "Agendamentos", "fa-calendar-check"],
      ["sessoes", "Sessões", "fa-comments"],
    ],
  },
  {
    label: "Executivo",
    items: [
      ["petit-comite", "Petit Comitê", "fa-briefcase"],
      ["petit-comite-mds", "Petit Comitê MDS", "fa-handshake"],
      ["coordenacao-cuidado", "Coordenação de Cuidado", "fa-heart-pulse"],
    ],
  },
  {
    label: "Sinistralidade",
    items: [
      ["analise-sinistro", "Análise Sinistro", "fa-file-invoice-dollar"],
      ["sinistralidade-v2", "Visão 360", "fa-compass-drafting"],
      ["preview-gold", "Preview Gold", "fa-layer-group"],
    ],
  },
  {
    label: "Qualidade",
    items: [
      ["qualidade-estrategica", "Estratégica", "fa-bullseye"],
      ["qualidade-operacional", "Operacional", "fa-list-check"],
    ],
  },
] as const;

const defaultLogo = { src: "/assets/logo_sanus.svg", alt: "Sanus", width: 112, height: 32 };

function legacy(name: string, ...args: unknown[]) {
  return window.SanusDashboard?.[name]?.(...args);
}

function normalizeDashboardUser(user: string) {
  return user.trim().toLowerCase();
}

function LoginOverlay({ authenticated }: { authenticated: boolean }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const auth = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ user: form.get("user"), password: form.get("password") }),
        schema: authResponseSchema,
      });
      window.location.href = auth.role === "mds" ? "/mds" : "/";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível validar o acesso.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-overlay" id="auth-overlay" style={{ display: authenticated ? "none" : "grid" }}>
      <form className="auth-card" onSubmit={submit}>
        <Image
          className="auth-logo"
          src="/assets/logo_sanus.svg"
          alt="Sanus"
          width={140}
          height={40}
          priority
        />
        <div className="auth-title">Acesso ao dashboard</div>
        <div className="auth-subtitle">
          Informe usuário e senha para carregar os indicadores e proteger as consultas do Databricks.
        </div>
        <div className="auth-field">
          <label htmlFor="auth-user">Usuário</label>
          <input id="auth-user" name="user" autoComplete="username" required />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-password">Senha</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button className="auth-submit" type="submit" disabled={submitting}>
          {submitting ? "Validando..." : "Entrar"}
        </button>
        <div className="auth-error" id="auth-error" style={{ display: error ? "block" : "none" }}>
          {error}
        </div>
      </form>
    </div>
  );
}

function Header({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  async function logout() {
    await apiRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/";
  }

  return (
    <header className="header">
      <div className="header-left">
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? "Abrir menu lateral" : "Fechar menu lateral"}
          aria-controls="dashboard-sidebar"
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <i className="fa-solid fa-bars" aria-hidden="true" />
        </button>
      </div>
      <div className="header-right">
        <span className="status loading" id="status">
          ⏳ Carregando...
        </span>
        <button className="refresh-btn" onClick={() => legacy("reload")}>
          ↻ Atualizar
        </button>
        <button className="auth-logout" onClick={logout}>
          Sair
        </button>
        <span className="last-upd" id="last-upd" />
      </div>
    </header>
  );
}

function Navigation({
  activeTab,
  hidePetitMds,
  sidebarCollapsed,
  onChange,
}: {
  activeTab: string;
  hidePetitMds: boolean;
  sidebarCollapsed: boolean;
  onChange: (tab: string) => void;
}) {
  return (
    <aside className="dashboard-sidebar" id="dashboard-sidebar" aria-label="Menu lateral do dashboard">
      <div className="sidebar-brand">
        <Image src={defaultLogo.src} alt={defaultLogo.alt} width={defaultLogo.width} height={defaultLogo.height} priority />
      </div>
      <nav className="tabs sidebar-nav" aria-label="Áreas do dashboard">
        {navSections.map((section) => (
          <div className="sidebar-section" key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items
              .filter(([id]) => !(hidePetitMds && id === "petit-comite-mds"))
              .map(([id, label, icon]) => (
                <button
                  type="button"
                  className={`tab sidebar-tab ${activeTab === id ? "active" : ""}`}
                  data-tab={id}
                  key={id}
                  title={sidebarCollapsed ? label : undefined}
                  onClick={() => onChange(id)}
                >
                  <i className={`fa-solid ${icon}`} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function Filters() {
  return (
    <div className="filterbar">
      <div className="filter-group" id="filter-group-group">
        <label>🏢 Grupo Econômico</label>
        <div className="multi-select" id="group-select">
          <button
            type="button"
            className="filter-select multi-select-button"
            id="group-select-button"
            onClick={() => legacy("toggleGroupDropdown")}
          >
            <span id="group-select-label">(Todos os grupos)</span>
            <i className="fa-solid fa-chevron-down" />
          </button>
          <div className="multi-select-menu" id="group-select-menu">
            <input
              className="multi-select-search"
              id="group-select-search"
              type="text"
              placeholder="Buscar grupo..."
              onInput={() => legacy("renderGroupOptions")}
            />
            <div className="multi-select-actions">
              <button type="button" onClick={() => legacy("selectAllGroupSelection")}>
                Selecionar todos
              </button>
              <button type="button" onClick={() => legacy("clearGroupSelection")}>
                Limpar
              </button>
              <button type="button" onClick={() => legacy("closeGroupDropdown")}>
                Fechar
              </button>
            </div>
            <div className="multi-select-options" id="group-select-options" />
          </div>
        </div>
      </div>
      <div className="filter-group" id="filter-company-group">
        <label>🏬 Empresa</label>
        <select className="filter-select" id="company-select" disabled>
          <option value="">(Selecione um grupo primeiro)</option>
        </select>
      </div>
      <div className="filter-group" id="filter-partner-group" style={{ display: "none" }}>
        <label>🤝 Parceiro</label>
        <select className="filter-select" id="partner-select" disabled>
          <option value="">(Todos os parceiros)</option>
        </select>
      </div>
      <div className="filter-group" id="filter-type-group">
        <label>👤 Tipo Beneficiário</label>
        <select className="filter-select" id="type-select">
          <option value="">(Todos)</option>
          <option value="TITULAR">Titular</option>
          <option value="DEPENDENTE">Dependente</option>
        </select>
      </div>
      <div className="filter-group" id="filter-periodo" style={{ display: "none" }}>
        <label>📅 Período</label>
        <div style={{ position: "relative" }}>
          <button
            id="periodo-btn"
            onClick={() => legacy("togglePeriodoDropdown")}
            className="filter-select multi-select-button"
          >
            <span id="periodo-label">(Todos os meses)</span>
            <i className="fa-solid fa-chevron-down" />
          </button>
          <div id="periodo-dropdown" className="multi-select-menu">
            <div className="multi-select-actions">
              <button type="button" onClick={() => legacy("selectAllPeriodo")}>
                Selecionar tudo
              </button>
              <button type="button" onClick={() => legacy("clearPeriodo")}>
                Limpar
              </button>
            </div>
            <div id="periodo-options" />
            <label>
              <input
                type="checkbox"
                id="cb-tudo"
                onChange={(event) => legacy("onTudoChange", event.currentTarget)}
              />{" "}
              Tudo (sem filtro de período)
            </label>
          </div>
        </div>
      </div>
      <div
        className="filter-group"
        id="filter-quality-operational-collaborator-group"
        style={{ display: "none" }}
      >
        <label>Colaborador</label>
        <div className="multi-select" id="quality-operational-collaborator-select">
          <button
            type="button"
            className="filter-select multi-select-button"
            id="quality-operational-collaborator-button"
            onClick={() => legacy("toggleQualityOperationalCollaboratorDropdown")}
          >
            <span id="quality-operational-collaborator-label">(Todos os colaboradores)</span>
            <i className="fa-solid fa-chevron-down" />
          </button>
          <div className="multi-select-menu" id="quality-operational-collaborator-menu">
            <input
              className="multi-select-search"
              id="quality-operational-collaborator-search"
              placeholder="Buscar colaborador..."
              onInput={() => legacy("renderQualityOperationalCollaboratorOptions")}
            />
            <div className="multi-select-actions">
              <button type="button" onClick={() => legacy("selectAllQualityOperationalCollaborators")}>
                Selecionar todos
              </button>
              <button type="button" onClick={() => legacy("clearQualityOperationalCollaborators")}>
                Limpar
              </button>
              <button type="button" onClick={() => legacy("closeQualityOperationalCollaboratorDropdown")}>
                Fechar
              </button>
            </div>
            <div className="multi-select-options" id="quality-operational-collaborator-options" />
          </div>
        </div>
      </div>
      <div className="filter-group" id="filter-quality-operational-setor-group" style={{ display: "none" }}>
        <label htmlFor="quality-operational-setor-filter">Setor</label>
        <select
          className="filter-select"
          id="quality-operational-setor-filter"
          onChange={(event) => legacy("onQualityOperationalSetorFilterChange", event.target.value)}
        >
          <option value="">Todos</option>
        </select>
      </div>
      <div className="filter-group" id="filter-quality-operational-status-group" style={{ display: "none" }}>
        <label htmlFor="quality-operational-status-filter">Status</label>
        <select
          className="filter-select"
          id="quality-operational-status-filter"
          onChange={(event) => legacy("onQualityOperationalStatusFilterChange", event.target.value)}
        >
          <option value="">Todos</option>
        </select>
      </div>
      <button className="clear-btn" onClick={() => legacy("clearFilters")}>
        ✕ Limpar
      </button>
      <div
        className="pdf-control filter-pdf-control is-busy"
        id="pdf-ready-control"
        style={{ display: "none" }}
      >
        <button
          className="pdf-btn"
          id="pdf-download-btn"
          onClick={() => legacy("downloadDashboardPdf")}
          disabled
        >
          <i className="fa-solid fa-file-pdf" />
          Baixar PDF
        </button>
        <div className="pdf-ready-track">
          <div className="pdf-ready-fill" id="pdf-ready-fill" />
        </div>
        <div className="pdf-ready-label" id="pdf-ready-label">
          0% pronto
        </div>
      </div>
      <span id="filter-info" style={{ fontSize: 11, color: "#bbb", marginLeft: "auto" }} />
    </div>
  );
}

export function DashboardShell() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState("demografica");
  const [dashboardUser, setDashboardUser] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const hidePetitMds = dashboardUser === "sanus";

  const activate = useCallback((tab: string) => {
    const nextTab = hidePetitMds && tab === "petit-comite-mds" ? "demografica" : tab;
    setActiveTab(nextTab);
    legacy("activateTab", nextTab);
    if (window.matchMedia("(max-width: 760px)").matches) setSidebarCollapsed(true);
  }, [hidePetitMds]);

  useEffect(() => {
    apiRequest("/api/data?scope=auth", { schema: authResponseSchema })
      .then((auth) => {
        setDashboardUser(normalizeDashboardUser(auth.user));
        setAuthenticated(true);
      })
      .catch(() => {
        setDashboardUser("");
        setAuthenticated(false);
      });
    const onTabChange = (event: Event) => setActiveTab((event as CustomEvent<string>).detail);
    const onUserChange = (event: Event) =>
      setDashboardUser(normalizeDashboardUser((event as CustomEvent<string>).detail || ""));
    document.addEventListener("sanus:tabchange", onTabChange);
    document.addEventListener("sanus:userchange", onUserChange);
    return () => {
      document.removeEventListener("sanus:tabchange", onTabChange);
      document.removeEventListener("sanus:userchange", onUserChange);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("auth-locked", !authenticated);
  }, [authenticated]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    if (dashboardUser) document.body.dataset.dashboardUser = dashboardUser;
    else delete document.body.dataset.dashboardUser;
  }, [dashboardUser]);

  useEffect(() => {
    document.body.dataset.sidebar = sidebarCollapsed ? "collapsed" : "expanded";
    return () => {
      delete document.body.dataset.sidebar;
    };
  }, [sidebarCollapsed]);

  return (
    <>
      <LoginOverlay authenticated={authenticated} />
      <Header
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      />
      <Navigation
        activeTab={activeTab}
        hidePetitMds={hidePetitMds}
        sidebarCollapsed={sidebarCollapsed}
        onChange={activate}
      />
      <Filters />
    </>
  );
}
