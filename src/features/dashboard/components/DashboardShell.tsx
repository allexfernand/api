"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { apiRequest } from "../../../lib/api/client";
import { authResponseSchema } from "../../../contracts/auth";
import { PASSWORD_RULES, validateStrongPassword } from "../../../lib/password-policy";
import { MENU_SECTIONS, type MenuId } from "../../../dashboard/menu-catalog";

type LegacyDashboardApi = Record<string, (...args: unknown[]) => unknown>;

declare global {
  interface Window {
    SanusDashboard?: LegacyDashboardApi;
  }
}

const CONFIGURACOES_ITEM = { id: "configuracoes", label: "Configurações", icon: "fa-sliders" } as const;

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
  const [changePasswordFor, setChangePasswordFor] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpUser, setTotpUser] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState(false);
  const [totpQrDataUrl, setTotpQrDataUrl] = useState<string | null>(null);
  const [totpManualKey, setTotpManualKey] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  function resetToLogin() {
    setChangePasswordFor(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setTotpUser(null);
    setTotpSetup(false);
    setTotpQrDataUrl(null);
    setTotpManualKey(null);
    setTotpCode("");
    setError("");
  }

  function applyAuthChallenge(auth: {
    mustChangePassword?: boolean;
    needsTotpSetup?: boolean;
    needsTotp?: boolean;
    user?: string;
    role?: string;
    totpQrDataUrl?: string;
    totpManualKey?: string;
  }, fallbackUser: string) {
    if (auth.mustChangePassword) {
      setChangePasswordFor(auth.user || fallbackUser);
      setNewPassword("");
      setConfirmPassword("");
      return;
    }
    if (auth.needsTotpSetup) {
      setChangePasswordFor(null);
      setTotpUser(auth.user || fallbackUser);
      setTotpSetup(true);
      setTotpQrDataUrl(auth.totpQrDataUrl || null);
      setTotpManualKey(auth.totpManualKey || null);
      setTotpCode("");
      return;
    }
    if (auth.needsTotp) {
      setChangePasswordFor(null);
      setTotpUser(auth.user || fallbackUser);
      setTotpSetup(false);
      setTotpQrDataUrl(null);
      setTotpManualKey(null);
      setTotpCode("");
      return;
    }
    window.location.href = auth.role === "mds" ? "/mds" : "/";
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const user = String(form.get("user") || "");
    const password = String(form.get("password") || "");
    setSubmitting(true);
    setError("");
    try {
      const auth = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ user, password }),
        schema: authResponseSchema,
      });
      setCurrentPassword(password);
      applyAuthChallenge(auth, user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível validar o acesso.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changePasswordFor) return;
    if (newPassword !== confirmPassword) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }
    const strength = validateStrongPassword(newPassword);
    if (strength.length) {
      setError(strength.join("; "));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const auth = await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          user: changePasswordFor,
          currentPassword,
          newPassword,
        }),
        schema: authResponseSchema,
      });
      setCurrentPassword(newPassword);
      applyAuthChallenge(auth, changePasswordFor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível trocar a senha.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!totpUser) return;
    setSubmitting(true);
    setError("");
    try {
      // O servidor já grava o cookie de sessão no 200. Não podemos deixar o
      // parse do cliente bloquear o redirect (foi o caso do role "custom").
      const response = await fetch("/api/auth/totp/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode.replace(/\s+/g, "") }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }
      const parsed = authResponseSchema.safeParse(payload);
      const role = parsed.success ? parsed.data.role : payload?.role;
      window.location.assign(role === "mds" ? "/mds" : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível validar o autenticador.");
    } finally {
      setSubmitting(false);
    }
  }

  if (totpUser) {
    return (
      <div className="auth-overlay" id="auth-overlay" style={{ display: authenticated ? "none" : "grid" }}>
        <form className="auth-card" onSubmit={submitTotp}>
          <Image
            className="auth-logo"
            src="/assets/logo_sanus.svg"
            alt="Sanus"
            width={140}
            height={40}
            priority
          />
          <div className="auth-title">{totpSetup ? "Configurar autenticador" : "Verificação em duas etapas"}</div>
          <div className="auth-subtitle">
            {totpSetup
              ? "Escaneie o QR Code no Google Authenticator, Authy ou app equivalente e digite o código de 6 dígitos para concluir a configuração."
              : `Digite o código de 6 dígitos gerado no app de segurança da conta ${totpUser}.`}
          </div>
          {totpSetup && totpQrDataUrl ? (
            <div className="auth-totp-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={totpQrDataUrl} alt="QR Code do autenticador" width={220} height={220} />
            </div>
          ) : null}
          {totpSetup && totpManualKey ? (
            <div className="auth-totp-manual">
              Chave manual: <code>{totpManualKey}</code>
            </div>
          ) : null}
          <div className="auth-field">
            <label htmlFor="auth-totp-code">Código de 6 dígitos</label>
            <input
              id="auth-totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <button className="auth-submit" type="submit" disabled={submitting || totpCode.length !== 6}>
            {submitting ? "Validando..." : totpSetup ? "Confirmar e entrar" : "Entrar"}
          </button>
          <button type="button" className="auth-back" onClick={resetToLogin}>
            Voltar ao login
          </button>
          <div className="auth-error" style={{ display: error ? "block" : "none" }}>
            {error}
          </div>
        </form>
      </div>
    );
  }

  if (changePasswordFor) {
    return (
      <div className="auth-overlay" id="auth-overlay" style={{ display: authenticated ? "none" : "grid" }}>
        <form className="auth-card" onSubmit={submitChangePassword}>
          <Image
            className="auth-logo"
            src="/assets/logo_sanus.svg"
            alt="Sanus"
            width={140}
            height={40}
            priority
          />
          <div className="auth-title">Definir nova senha</div>
          <div className="auth-subtitle">
            Por segurança, a conta <strong>{changePasswordFor}</strong> precisa criar uma senha
            forte antes do primeiro acesso ao painel.
          </div>
          <div className="auth-field">
            <label htmlFor="auth-new-password">Nova senha</label>
            <input
              id="auth-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="auth-confirm-password">Confirmar nova senha</label>
            <input
              id="auth-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>
          <ul className="auth-password-rules" aria-label="Requisitos da senha">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(newPassword);
              return (
                <li key={rule.id} className={ok ? "ok" : undefined}>
                  {ok ? "✓" : "•"} {rule.label}
                </li>
              );
            })}
          </ul>
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Salvando..." : "Salvar e continuar"}
          </button>
          <button type="button" className="auth-back" onClick={resetToLogin}>
            Voltar ao login
          </button>
          <div className="auth-error" style={{ display: error ? "block" : "none" }}>
            {error}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-overlay" id="auth-overlay" style={{ display: authenticated ? "none" : "grid" }}>
      <form className="auth-card" onSubmit={submitLogin}>
        <Image
          className="auth-logo"
          src="/assets/logo_sanus.svg"
          alt="Sanus"
          width={140}
          height={40}
          priority
        />
        <div className="auth-title">Bem-vindo à Sanus</div>
        <div className="auth-subtitle">
          Entre com suas credenciais para acessar o painel de indicadores da carteira.
          O acesso é pessoal e confidencial.
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
          {submitting ? "Entrando..." : "Entrar"}
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
  isMenuVisible,
  isAdmin,
  sidebarCollapsed,
  onChange,
}: {
  activeTab: string;
  isMenuVisible: (id: MenuId) => boolean;
  isAdmin: boolean;
  sidebarCollapsed: boolean;
  onChange: (tab: string) => void;
}) {
  return (
    <aside className="dashboard-sidebar" id="dashboard-sidebar" aria-label="Menu lateral do dashboard">
      <div className="sidebar-brand">
        <Image src={defaultLogo.src} alt={defaultLogo.alt} width={defaultLogo.width} height={defaultLogo.height} priority />
      </div>
      <nav className="tabs sidebar-nav" aria-label="Áreas do dashboard">
        {MENU_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => isMenuVisible(item.id));
          if (!visibleItems.length) return null;
          return (
            <div className="sidebar-section" key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {visibleItems.map(({ id, label, icon }) => (
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
          );
        })}
        {isAdmin ? (
          <div className="sidebar-section" key="admin">
            <div className="sidebar-section-label">Administração</div>
            <button
              type="button"
              className={`tab sidebar-tab ${activeTab === CONFIGURACOES_ITEM.id ? "active" : ""}`}
              data-tab={CONFIGURACOES_ITEM.id}
              title={sidebarCollapsed ? CONFIGURACOES_ITEM.label : undefined}
              onClick={() => onChange(CONFIGURACOES_ITEM.id)}
            >
              <i className={`fa-solid ${CONFIGURACOES_ITEM.icon}`} aria-hidden="true" />
              <span>{CONFIGURACOES_ITEM.label}</span>
            </button>
          </div>
        ) : null}
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
      <div className="filter-group" id="filter-partner-multi-group" style={{ display: "none" }}>
        <label>🤝 Parceiros</label>
        <div className="multi-select" id="partner-multi-select">
          <button
            type="button"
            className="filter-select multi-select-button"
            id="partner-multi-select-button"
            onClick={() => legacy("togglePartnerMultiDropdown")}
          >
            <span id="partner-multi-select-label">(Todos os parceiros)</span>
            <i className="fa-solid fa-chevron-down" />
          </button>
          <div className="multi-select-menu" id="partner-multi-select-menu">
            <input
              className="multi-select-search"
              id="partner-multi-select-search"
              type="text"
              placeholder="Buscar parceiro..."
              onInput={() => legacy("renderPartnerMultiOptions")}
            />
            <div className="multi-select-actions">
              <button type="button" onClick={() => legacy("selectAllPartnerSelection")}>
                Selecionar todos
              </button>
              <button type="button" onClick={() => legacy("clearPartnerSelection")}>
                Limpar
              </button>
              <button type="button" onClick={() => legacy("closePartnerMultiDropdown")}>
                Fechar
              </button>
            </div>
            <div className="multi-select-options" id="partner-multi-select-options" />
          </div>
        </div>
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

// Comportamento quando ninguém configurou lista explícita em Configurações.
// Perfil Completo = todas as funcionalidades (inclui Visão Parceiros).
function legacyMenuVisible(id: MenuId, dashboardUser: string, dashboardRole: string): boolean {
  if (dashboardRole === "full" || dashboardRole === "custom") return id !== "petit-comite-mds";
  if (id === "visao-parceiros") return dashboardUser === "sanus";
  if (id === "petit-comite-mds") return dashboardUser !== "sanus";
  if (dashboardRole === "mds") {
    return !(["analise-sinistro", "sinistralidade-v2", "qualidade-estrategica", "qualidade-operacional"] as MenuId[]).includes(id);
  }
  return true;
}

export function DashboardShell() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState("demografica");
  const [dashboardUser, setDashboardUser] = useState("");
  const [dashboardRole, setDashboardRole] = useState("");
  const [allowedMenus, setAllowedMenus] = useState<MenuId[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches,
  );

  const isMenuVisible = useCallback(
    (id: MenuId) => (allowedMenus ? allowedMenus.includes(id) : legacyMenuVisible(id, dashboardUser, dashboardRole)),
    [allowedMenus, dashboardUser, dashboardRole],
  );

  const activate = useCallback((tab: string) => {
    let nextTab = tab;
    if (tab === "configuracoes") {
      if (!isAdmin) nextTab = "demografica";
    } else if (!isMenuVisible(tab as MenuId)) {
      nextTab = "demografica";
    }
    setActiveTab(nextTab);
    legacy("activateTab", nextTab);
    if (window.matchMedia("(max-width: 760px)").matches) setSidebarCollapsed(true);
  }, [isAdmin, isMenuVisible]);

  useEffect(() => {
    // Não trava a UI só porque o Zod falhou em um campo opcional — se a sessão
    // respondeu 200 com ok:true, libera o shell e aplica o que der pra ler.
    fetch("/api/data?scope=auth", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const parsed = authResponseSchema.safeParse(payload);
        const auth = parsed.success
          ? parsed.data
          : payload?.ok === true
            ? {
                ok: true as const,
                user: String(payload.user || ""),
                role: typeof payload.role === "string" ? payload.role : "",
                allowedMenus: Array.isArray(payload.allowedMenus) ? payload.allowedMenus : null,
                isAdmin: Boolean(payload.isAdmin),
              }
            : null;
        if (!auth) throw new Error("Sessão inválida");
        setDashboardUser(normalizeDashboardUser(auth.user || ""));
        setDashboardRole(auth.role || "");
        setAllowedMenus((auth.allowedMenus as MenuId[] | null) ?? null);
        setIsAdmin(Boolean(auth.isAdmin));
        setAuthenticated(true);
      })
      .catch(() => {
        setDashboardUser("");
        setDashboardRole("");
        setAllowedMenus(null);
        setIsAdmin(false);
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
    if (dashboardUser) document.body.dataset.dashboardUser = dashboardUser;
    else delete document.body.dataset.dashboardUser;
  }, [dashboardUser]);

  useEffect(() => {
    if (dashboardRole) document.body.dataset.dashboardRole = dashboardRole;
    else delete document.body.dataset.dashboardRole;
  }, [dashboardRole]);

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
        isMenuVisible={isMenuVisible}
        isAdmin={isAdmin}
        sidebarCollapsed={sidebarCollapsed}
        onChange={activate}
      />
      <Filters />
    </>
  );
}
