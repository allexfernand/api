"use client";

// Tela de Configurações: só é montada quando o usuário logado é admin (ver
// DashboardShell). Deixa escolher um usuário do dashboard (contas legadas
// sanus/mds ou criadas aqui) e marcar quais menus laterais ele pode acessar.
// Sem seleção explícita de menus, o usuário mantém o comportamento de hoje —
// ver legacyMenuVisible em DashboardShell.tsx e hasMenuAccess no servidor.

import { FormEvent, useMemo, useState } from "react";
import styles from "./SettingsTab.module.css";
import { useManagedUsers, type PartnerGroupMap, type PartnerOption } from "./hooks/useManagedUsers";
import { MENU_SECTIONS, FULL_DEFAULT_ALLOWED_MENUS, MDS_DEFAULT_ALLOWED_MENUS, type MenuId } from "../../dashboard/menu-catalog";
import type { DashboardRole } from "../../contracts/common";
import type { ManagedDashboardUserPublic } from "../../contracts/dashboard-users";
import { PASSWORD_RULES, validateStrongPassword } from "../../lib/password-policy";

function defaultMenusFor(role: DashboardRole): MenuId[] {
  return role === "mds" ? [...MDS_DEFAULT_ALLOWED_MENUS] : [...FULL_DEFAULT_ALLOWED_MENUS];
}

// União dos grupos econômicos ligados aos parceiros selecionados. As
// "empresas" (filiais) já entram no recorte do servidor via matriz_id —
// liberar o grupo econômico cobre a carteira inteira do parceiro.
function groupsForPartners(partnerIds: string[], partnerGroupMap: PartnerGroupMap): string[] {
  const groups = new Set<string>();
  for (const id of partnerIds) {
    for (const group of partnerGroupMap[id] ?? []) groups.add(group);
  }
  return [...groups].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function PasswordRulesHint({ password }: { password: string }) {
  if (!password) return null;
  return (
    <ul className={styles.passwordRules} aria-label="Requisitos da senha">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <li key={rule.id} className={ok ? styles.passwordRuleOk : undefined}>
            {ok ? "✓" : "•"} {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

export function SettingsTab() {
  const { users, economicGroups, partners, partnerGroupMap, status, error, createUser, updateUser, deleteUser } =
    useManagedUsers();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Deriva a seleção em vez de sincronizá-la via efeito: sem usuário
  // escolhido (ou se ele saiu da lista), cai no primeiro da lista — a menos
  // que o formulário de criação esteja aberto.
  const selectedUser = useMemo(() => {
    if (creating || !users) return null;
    const match = selected ? users.find((u) => u.user === selected) : null;
    return match ?? users[0] ?? null;
  }, [users, selected, creating]);

  return (
    <section id="tab-configuracoes" className={`tab-content ${styles.root}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>Configurações de acesso</h2>
        <p className={styles.subtitle}>
          Escolha um usuário, marque parceiros e menus liberados. Ao selecionar um parceiro, os grupos
          econômicos dele são atribuídos automaticamente ao perfil.
        </p>
      </header>

      {status === "loading" ? <p className={styles.subtitle}>Carregando usuários…</p> : null}
      {status === "forbidden" ? <p className={styles.notice}>Acesso restrito a administradores.</p> : null}
      {status === "error" ? <p className={styles.notice}>{error ?? "Não foi possível carregar os usuários."}</p> : null}

      {status === "ready" && users ? (
        <div className={styles.layout}>
          <UserList
            users={users}
            selected={selectedUser?.user ?? null}
            creating={creating}
            onSelect={(user) => {
              setCreating(false);
              setSelected(user);
            }}
            onCreateNew={() => {
              setCreating(true);
              setSelected(null);
            }}
          />
          {creating ? (
            <CreateUserPanel
              economicGroups={economicGroups}
              partners={partners}
              partnerGroupMap={partnerGroupMap}
              onCancel={() => setCreating(false)}
              onCreate={async (input) => {
                const created = await createUser(input);
                setCreating(false);
                setSelected(created.user);
              }}
            />
          ) : selectedUser ? (
            <UserEditorPanel
              key={selectedUser.user}
              user={selectedUser}
              economicGroups={economicGroups}
              partners={partners}
              partnerGroupMap={partnerGroupMap}
              onSave={(input) => updateUser(selectedUser.user, input)}
              onDelete={selectedUser.isLegacy ? undefined : () => deleteUser(selectedUser.user)}
            />
          ) : (
            <div className={styles.panel}>
              <div className={styles.emptyPanel}>Selecione um usuário na lista ao lado.</div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function UserList({
  users,
  selected,
  creating,
  onSelect,
  onCreateNew,
}: {
  users: ManagedDashboardUserPublic[];
  selected: string | null;
  creating: boolean;
  onSelect: (user: string) => void;
  onCreateNew: () => void;
}) {
  return (
    <div className={styles.userList}>
      <div className={styles.userListLabel}>Usuários</div>
      {users.map((user) => (
        <button
          type="button"
          key={user.user}
          className={`${styles.userRow} ${!creating && selected === user.user ? styles.userRowActive : ""}`}
          onClick={() => onSelect(user.user)}
        >
          <span>
            <div className={styles.userRowName}>{user.user}</div>
            <div className={styles.userRowMeta}>
              {user.role === "mds" ? "Perfil MDS" : "Perfil completo"}
              {user.isAdmin ? " · Admin" : ""}
            </div>
          </span>
          {user.isLegacy ? <span className={styles.badge}>Padrão</span> : null}
        </button>
      ))}
      <button type="button" className={styles.addButton} onClick={onCreateNew}>
        <i className="fa-solid fa-plus" aria-hidden="true" /> Novo usuário
      </button>
    </div>
  );
}

function MenuAccessEditor({
  role,
  allowedMenus,
  onChange,
}: {
  role: DashboardRole;
  allowedMenus: MenuId[] | null;
  onChange: (next: MenuId[] | null) => void;
}) {
  const isCustom = allowedMenus !== null;

  return (
    <div>
      <div className={styles.menuAccessHeader}>
        <div>
          <div className={styles.menuAccessTitle}>Menus liberados</div>
          <div className={styles.menuAccessHint}>
            {isCustom
              ? "Personalizado — só os menus marcados abaixo aparecem para este usuário."
              : "Sem personalização — este usuário mantém o comportamento padrão de hoje."}
          </div>
        </div>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => onChange(isCustom ? null : defaultMenusFor(role))}
        >
          {isCustom ? "Restaurar padrão" : "Personalizar menus"}
        </button>
      </div>
      {isCustom ? (
        <div className={styles.menuSections} style={{ marginTop: 12 }}>
          {MENU_SECTIONS.map((section) => (
            <div className={styles.menuSection} key={section.label}>
              <div className={styles.menuSectionLabel}>{section.label}</div>
              {section.items.map((item) => (
                <label className={styles.checkboxLabel} key={item.id}>
                  <input
                    type="checkbox"
                    checked={allowedMenus!.includes(item.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...allowedMenus!, item.id]
                        : allowedMenus!.filter((id) => id !== item.id);
                      onChange(next);
                    }}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GroupAccessEditor({
  groupScopes,
  economicGroups,
  partnerSyncedCount,
  onChange,
}: {
  groupScopes: string[] | null;
  economicGroups: string[];
  partnerSyncedCount?: number | null;
  onChange: (next: string[] | null) => void;
}) {
  const isCustom = groupScopes !== null;
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return economicGroups;
    return economicGroups.filter((name) => name.toLowerCase().includes(query));
  }, [economicGroups, search]);

  return (
    <div>
      <div className={styles.menuAccessHeader}>
        <div>
          <div className={styles.menuAccessTitle}>Grupos econômicos liberados</div>
          <div className={styles.menuAccessHint}>
            {isCustom
              ? partnerSyncedCount != null && partnerSyncedCount > 0
                ? `Preenchido pelos parceiros selecionados — ${groupScopes!.length} grupo(s). Você ainda pode ajustar manualmente.`
                : `Personalizado — enxerga dados só de ${groupScopes!.length} grupo(s) marcado(s) abaixo.`
              : "Sem personalização — este usuário enxerga dados de todos os grupos econômicos."}
          </div>
        </div>
        <button type="button" className={styles.linkButton} onClick={() => onChange(isCustom ? null : [])}>
          {isCustom ? "Remover restrição" : "Restringir por grupo"}
        </button>
      </div>
      {isCustom ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <div className={styles.pickerToolbar}>
            <input
              type="text"
              className={styles.input}
              placeholder="Buscar grupo econômico…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className={styles.pickerActions}>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  const next = new Set(groupScopes ?? []);
                  for (const name of filtered) next.add(name);
                  onChange([...next]);
                }}
                disabled={filtered.length === 0}
              >
                Selecionar todos{search.trim() ? " (filtrados)" : ""}
              </button>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onChange([])}
                disabled={!groupScopes?.length}
              >
                Limpar
              </button>
            </div>
          </div>
          <div className={styles.groupPickerList}>
            {economicGroups.length === 0 ? (
              <div className={styles.groupPickerEmpty}>Nenhum grupo econômico carregado.</div>
            ) : filtered.length === 0 ? (
              <div className={styles.groupPickerEmpty}>Nenhum grupo encontrado para &quot;{search}&quot;.</div>
            ) : (
              filtered.map((name) => (
                <label className={styles.checkboxLabel} key={name}>
                  <input
                    type="checkbox"
                    checked={groupScopes!.includes(name)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...groupScopes!, name]
                        : groupScopes!.filter((existing) => existing !== name);
                      onChange(next);
                    }}
                  />
                  {name}
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PartnerAccessEditor({
  partnerScopes,
  partners,
  onChange,
}: {
  partnerScopes: string[] | null;
  partners: PartnerOption[];
  onChange: (next: string[] | null) => void;
}) {
  const isCustom = partnerScopes !== null;
  const [search, setSearch] = useState("");

  const nameById = useMemo(() => new Map(partners.map((p) => [p.broker_id, p.broker_name])), [partners]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return partners;
    return partners.filter((p) => p.broker_name.toLowerCase().includes(query));
  }, [partners, search]);

  return (
    <div>
      <div className={styles.menuAccessHeader}>
        <div>
          <div className={styles.menuAccessTitle}>Parceiros liberados</div>
          <div className={styles.menuAccessHint}>
            {isCustom
              ? `Personalizado — enxerga dados só de ${partnerScopes!.length} parceiro(s). Os grupos econômicos deles são liberados automaticamente.`
              : "Sem personalização — este usuário enxerga dados de todos os parceiros."}
          </div>
        </div>
        <button type="button" className={styles.linkButton} onClick={() => onChange(isCustom ? null : [])}>
          {isCustom ? "Remover restrição" : "Restringir por parceiro"}
        </button>
      </div>
      {isCustom ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <div className={styles.pickerToolbar}>
            <input
              type="text"
              className={styles.input}
              placeholder="Buscar parceiro…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className={styles.pickerActions}>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  const next = new Set(partnerScopes ?? []);
                  for (const partner of filtered) next.add(partner.broker_id);
                  onChange([...next]);
                }}
                disabled={filtered.length === 0}
              >
                Selecionar todos{search.trim() ? " (filtrados)" : ""}
              </button>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onChange([])}
                disabled={!partnerScopes?.length}
              >
                Limpar
              </button>
            </div>
          </div>
          <div className={styles.groupPickerList}>
            {partners.length === 0 ? (
              <div className={styles.groupPickerEmpty}>Nenhum parceiro carregado.</div>
            ) : filtered.length === 0 ? (
              <div className={styles.groupPickerEmpty}>Nenhum parceiro encontrado para &quot;{search}&quot;.</div>
            ) : (
              filtered.map((partner) => (
                <label className={styles.checkboxLabel} key={partner.broker_id}>
                  <input
                    type="checkbox"
                    checked={partnerScopes!.includes(partner.broker_id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...partnerScopes!, partner.broker_id]
                        : partnerScopes!.filter((existing) => existing !== partner.broker_id);
                      onChange(next);
                    }}
                  />
                  {partner.broker_name}
                </label>
              ))
            )}
          </div>
          {partnerScopes!.some((id) => !nameById.has(id)) ? (
            <div className={styles.groupPickerEmpty} style={{ textAlign: "left" }}>
              Obs.: há parceiro(s) salvo(s) que não aparecem na lista acima (podem ter sido removidos).
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UserEditorPanel({
  user,
  economicGroups,
  partners,
  partnerGroupMap,
  onSave,
  onDelete,
}: {
  user: ManagedDashboardUserPublic;
  economicGroups: string[];
  partners: PartnerOption[];
  partnerGroupMap: PartnerGroupMap;
  onSave: (input: {
    role?: DashboardRole;
    isAdmin?: boolean;
    allowedMenus?: MenuId[] | null;
    groupScopes?: string[] | null;
    partnerScopes?: string[] | null;
    mustChangePassword?: boolean;
    password?: string;
  }) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}) {
  const [role, setRole] = useState<DashboardRole>(user.role);
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [allowedMenus, setAllowedMenus] = useState<MenuId[] | null>(user.allowedMenus);
  const [groupScopes, setGroupScopes] = useState<string[] | null>(user.groupScopes);
  const [partnerScopes, setPartnerScopes] = useState<string[] | null>(user.partnerScopes);
  const [mustChangePassword, setMustChangePassword] = useState(Boolean(user.mustChangePassword));
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  function applyPartnerScopes(next: string[] | null) {
    setPartnerScopes(next);
    // Ao restringir/alterar parceiros, sincroniza os grupos econômicos da
    // carteira deles (inclui as empresas-filiais via matriz no servidor).
    if (next !== null) setGroupScopes(groupsForPartners(next, partnerGroupMap));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password) {
      const strength = validateStrongPassword(password);
      if (strength.length) {
        setFeedback({ ok: false, message: `Senha fraca: ${strength.join("; ")}` });
        return;
      }
    }
    setSaving(true);
    setFeedback(null);
    try {
      await onSave({
        role,
        isAdmin,
        allowedMenus,
        groupScopes,
        partnerScopes,
        mustChangePassword: user.isLegacy ? undefined : mustChangePassword,
        password: password || undefined,
      });
      setPassword("");
      setFeedback({ ok: true, message: "Alterações salvas." });
    } catch (cause) {
      setFeedback({ ok: false, message: cause instanceof Error ? cause.message : "Não foi possível salvar." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    if (!window.confirm(`Remover o usuário "${user.user}"? Essa ação não pode ser desfeita.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (cause) {
      setFeedback({ ok: false, message: cause instanceof Error ? cause.message : "Não foi possível remover." });
      setDeleting(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={submit}>
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.panelUserName}>{user.user}</div>
          <div className={styles.panelUserHint}>
            {user.isLegacy
              ? "Conta padrão do dashboard — a senha continua vindo das variáveis de ambiente."
              : "Conta criada em Configurações."}
          </div>
        </div>
        {onDelete ? (
          <button type="button" className={styles.deleteButton} onClick={remove} disabled={deleting}>
            {deleting ? "Removendo…" : "Remover usuário"}
          </button>
        ) : null}
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="user-role">
            Perfil de dados
          </label>
          <select
            id="user-role"
            className={styles.select}
            value={role}
            onChange={(event) => setRole(event.target.value as DashboardRole)}
          >
            <option value="full">Completo</option>
            <option value="mds">MDS</option>
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Administrador</span>
          <label className={styles.switchRow}>
            <input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} />
            Acessa Configurações
          </label>
        </div>
        {!user.isLegacy ? (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="user-password">
              Nova senha (opcional)
            </label>
            <input
              id="user-password"
              className={styles.input}
              type="password"
              placeholder="Deixe em branco para manter"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={10}
            />
            <PasswordRulesHint password={password} />
          </div>
        ) : null}
      </div>

      {!user.isLegacy ? (
        <label className={styles.switchRow} style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={mustChangePassword}
            onChange={(event) => setMustChangePassword(event.target.checked)}
          />
          Trocar senha no próximo login
        </label>
      ) : null}

      <MenuAccessEditor role={role} allowedMenus={allowedMenus} onChange={setAllowedMenus} />

      <PartnerAccessEditor partnerScopes={partnerScopes} partners={partners} onChange={applyPartnerScopes} />

      <GroupAccessEditor
        groupScopes={groupScopes}
        economicGroups={economicGroups}
        partnerSyncedCount={partnerScopes?.length ?? null}
        onChange={setGroupScopes}
      />

      <div className={styles.actions}>
        <button type="submit" className={styles.saveButton} disabled={saving}>
          {saving ? "Salvando…" : "Salvar alterações"}
        </button>
        {feedback ? (
          <span className={`${styles.saveHint} ${feedback.ok ? styles.saveHintOk : styles.saveHintError}`}>
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function CreateUserPanel({
  economicGroups,
  partners,
  partnerGroupMap,
  onCancel,
  onCreate,
}: {
  economicGroups: string[];
  partners: PartnerOption[];
  partnerGroupMap: PartnerGroupMap;
  onCancel: () => void;
  onCreate: (input: {
    user: string;
    password: string;
    role: DashboardRole;
    isAdmin: boolean;
    allowedMenus: MenuId[];
    groupScopes: string[] | null;
    partnerScopes: string[] | null;
    mustChangePassword: boolean;
  }) => Promise<unknown>;
}) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<DashboardRole>("mds");
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowedMenus, setAllowedMenus] = useState<MenuId[]>([]);
  const [groupScopes, setGroupScopes] = useState<string[] | null>([]);
  const [partnerScopes, setPartnerScopes] = useState<string[] | null>([]);
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  function applyPartnerScopes(next: string[] | null) {
    setPartnerScopes(next);
    if (next !== null) setGroupScopes(groupsForPartners(next, partnerGroupMap));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const strength = validateStrongPassword(password);
    if (strength.length) {
      setFeedback(`Senha fraca: ${strength.join("; ")}`);
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await onCreate({
        user,
        password,
        role,
        isAdmin,
        allowedMenus,
        groupScopes,
        partnerScopes,
        mustChangePassword,
      });
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível criar o usuário.");
      setSaving(false);
    }
  }

  return (
    <form className={`${styles.panel} ${styles.createForm}`} onSubmit={submit}>
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.panelUserName}>Novo usuário</div>
          <div className={styles.panelUserHint}>
            Cria um login próprio. Ao marcar um parceiro, os grupos econômicos dele entram no perfil
            automaticamente.
          </div>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="new-user">
            Usuário
          </label>
          <input
            id="new-user"
            className={styles.input}
            value={user}
            onChange={(event) => setUser(event.target.value)}
            minLength={3}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="new-password">
            Senha
          </label>
          <input
            id="new-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={10}
            required
          />
          <PasswordRulesHint password={password} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="new-role">
            Perfil de dados
          </label>
          <select
            id="new-role"
            className={styles.select}
            value={role}
            onChange={(event) => setRole(event.target.value as DashboardRole)}
          >
            <option value="mds">MDS</option>
            <option value="full">Completo</option>
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Administrador</span>
          <label className={styles.switchRow}>
            <input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} />
            Acessa Configurações
          </label>
        </div>
      </div>

      <label className={styles.switchRow}>
        <input
          type="checkbox"
          checked={mustChangePassword}
          onChange={(event) => setMustChangePassword(event.target.checked)}
        />
        Trocar senha no próximo login
      </label>

      <MenuAccessEditor
        role={role}
        allowedMenus={allowedMenus}
        onChange={(next) => setAllowedMenus(next ?? defaultMenusFor(role))}
      />

      <PartnerAccessEditor partnerScopes={partnerScopes} partners={partners} onChange={applyPartnerScopes} />

      <GroupAccessEditor
        groupScopes={groupScopes}
        economicGroups={economicGroups}
        partnerSyncedCount={partnerScopes?.length ?? null}
        onChange={setGroupScopes}
      />

      <div className={styles.actions}>
        <button type="submit" className={styles.saveButton} disabled={saving}>
          {saving ? "Criando…" : "Criar usuário"}
        </button>
        <button type="button" className={styles.linkButton} onClick={onCancel}>
          Cancelar
        </button>
        {feedback ? <span className={`${styles.saveHint} ${styles.saveHintError}`}>{feedback}</span> : null}
      </div>
    </form>
  );
}
