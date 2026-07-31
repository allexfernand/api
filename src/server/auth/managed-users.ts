// Camada de negócio dos usuários gerenciados pela tela de Configurações.
// Concilia dois mundos: as duas contas legadas (sanus/mds, autenticadas por
// env var, sem registro nenhum aqui até alguém configurar algo pra elas) e
// contas novas criadas nesta tela (usuário + senha própria, guardados no
// Edge Config). Nada disto muda o comportamento de quem nunca abriu
// Configurações — só existe efeito quando há um registro salvo.
import type { DashboardRole } from "../../contracts/common";
import {
  type CreateManagedUserRequest,
  type ManagedDashboardUser,
  type ManagedDashboardUserPublic,
  type UpdateManagedUserRequest,
} from "../../contracts/dashboard-users";
import { FULL_DEFAULT_ALLOWED_MENUS, MDS_DEFAULT_ALLOWED_MENUS, type MenuId } from "../../dashboard/menu-catalog";
import { isEdgeConfigWritable, readManagedUsers, writeManagedUsers } from "../config/edge-config-store";
import { validateDashboardCredentials } from "./credentials";
import { hashPassword, verifyPassword } from "./password";

export type EffectiveDashboardAuth = {
  user: string;
  role: DashboardRole;
  allowedMenus: MenuId[] | null;
  isAdmin: boolean;
  groupScopes: string[] | null;
};

function normalize(user: string) {
  return user.trim().toLowerCase();
}

function legacyUsernames(): { user: string; role: DashboardRole }[] {
  const entries: { user: string; role: DashboardRole }[] = [];
  const fullUser = (process.env.DASHBOARD_AUTH_USER || "").trim();
  const mdsUser = (process.env.DASHBOARD_MDS_AUTH_USER || "").trim();
  if (fullUser) entries.push({ user: fullUser, role: normalize(fullUser) === "mds" ? "mds" : "full" });
  if (mdsUser && normalize(mdsUser) !== normalize(fullUser)) entries.push({ user: mdsUser, role: "mds" });
  return entries;
}

function defaultAllowedMenusFor(role: DashboardRole): MenuId[] {
  return role === "mds" ? MDS_DEFAULT_ALLOWED_MENUS : FULL_DEFAULT_ALLOWED_MENUS;
}

async function findManagedUser(user: string): Promise<ManagedDashboardUser | undefined> {
  const users = await readManagedUsers();
  return users.find((entry) => normalize(entry.user) === normalize(user));
}

// Só usado no login: concilia a senha (env var OU hash salvo) com a
// permissão efetiva (overlay salvo OU baseline legado hoje em produção).
export async function resolveEffectiveAuth(user: string, password: string): Promise<EffectiveDashboardAuth | null> {
  const legacy = validateDashboardCredentials(user, password);
  const managed = await findManagedUser(user);
  if (legacy) {
    if (managed) {
      return {
        user: legacy.user,
        role: managed.role,
        allowedMenus: managed.allowedMenus,
        isAdmin: managed.isAdmin,
        groupScopes: managed.groupScopes,
      };
    }
    return {
      user: legacy.user,
      role: legacy.role,
      allowedMenus: null,
      isAdmin: normalize(legacy.user) === "sanus",
      groupScopes: null,
    };
  }
  if (managed?.passwordHash && verifyPassword(password, managed.passwordHash)) {
    return {
      user: managed.user,
      role: managed.role,
      allowedMenus: managed.allowedMenus,
      isAdmin: managed.isAdmin,
      groupScopes: managed.groupScopes,
    };
  }
  return null;
}

function toPublic(entry: ManagedDashboardUser, isLegacy: boolean): ManagedDashboardUserPublic {
  return {
    user: entry.user,
    role: entry.role,
    isAdmin: entry.isAdmin,
    allowedMenus: entry.allowedMenus,
    groupScopes: entry.groupScopes,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    isLegacy,
    hasCustomPassword: Boolean(entry.passwordHash),
  };
}

export async function listManagedUsersPublic(): Promise<ManagedDashboardUserPublic[]> {
  const stored = await readManagedUsers();
  const byName = new Map(stored.map((entry) => [normalize(entry.user), entry] as const));
  const result: ManagedDashboardUserPublic[] = [];
  const seen = new Set<string>();

  for (const legacy of legacyUsernames()) {
    const key = normalize(legacy.user);
    seen.add(key);
    const override = byName.get(key);
    result.push(
      override
        ? toPublic(override, true)
        : {
            user: legacy.user,
            role: legacy.role,
            isAdmin: key === "sanus",
            allowedMenus: null,
            groupScopes: null,
            createdAt: "",
            updatedAt: "",
            isLegacy: true,
            hasCustomPassword: false,
          },
    );
  }

  for (const entry of stored) {
    const key = normalize(entry.user);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(toPublic(entry, false));
  }

  return result;
}

export async function createManagedUser(input: CreateManagedUserRequest): Promise<ManagedDashboardUserPublic> {
  if (!isEdgeConfigWritable()) {
    throw new Error("Edge Config não está configurado para escrita. Veja as instruções em .env.example.");
  }
  const legacyMatch = legacyUsernames().some((entry) => normalize(entry.user) === normalize(input.user));
  if (legacyMatch) {
    throw new Error("Esse nome de usuário já existe como conta legada. Selecione-o na lista em vez de criar um novo.");
  }
  const users = await readManagedUsers();
  if (users.some((entry) => normalize(entry.user) === normalize(input.user))) {
    throw new Error("Já existe um usuário com esse nome.");
  }
  const now = new Date().toISOString();
  const record: ManagedDashboardUser = {
    user: input.user.trim(),
    passwordHash: hashPassword(input.password),
    role: input.role,
    isAdmin: input.isAdmin,
    allowedMenus: input.allowedMenus,
    groupScopes: input.groupScopes ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await writeManagedUsers([...users, record]);
  return toPublic(record, false);
}

export async function updateManagedUser(
  username: string,
  input: UpdateManagedUserRequest,
): Promise<ManagedDashboardUserPublic> {
  if (!isEdgeConfigWritable()) {
    throw new Error("Edge Config não está configurado para escrita. Veja as instruções em .env.example.");
  }
  const users = await readManagedUsers();
  const index = users.findIndex((entry) => normalize(entry.user) === normalize(username));
  const isLegacy = legacyUsernames().some((entry) => normalize(entry.user) === normalize(username));
  const now = new Date().toISOString();

  if (index === -1) {
    if (!isLegacy) throw new Error("Usuário não encontrado.");
    // Primeira vez que alguém restringe uma conta legada: cria o registro de
    // overlay (sem senha própria — continua autenticando pela env var).
    const legacy = legacyUsernames().find((entry) => normalize(entry.user) === normalize(username))!;
    const record: ManagedDashboardUser = {
      user: legacy.user,
      passwordHash: null,
      role: input.role ?? legacy.role,
      isAdmin: input.isAdmin ?? normalize(legacy.user) === "sanus",
      allowedMenus: input.allowedMenus ?? defaultAllowedMenusFor(input.role ?? legacy.role),
      groupScopes: input.groupScopes === undefined ? null : input.groupScopes,
      createdAt: now,
      updatedAt: now,
    };
    if (input.password) throw new Error("Contas legadas (sanus/mds) mantêm a senha da env var; não é possível trocá-la aqui.");
    await writeManagedUsers([...users, record]);
    return toPublic(record, true);
  }

  const current = users[index];
  if (isLegacy && input.password) {
    throw new Error("Contas legadas (sanus/mds) mantêm a senha da env var; não é possível trocá-la aqui.");
  }
  const updated: ManagedDashboardUser = {
    ...current,
    role: input.role ?? current.role,
    isAdmin: input.isAdmin ?? current.isAdmin,
    allowedMenus: input.allowedMenus === undefined ? current.allowedMenus : input.allowedMenus,
    groupScopes: input.groupScopes === undefined ? current.groupScopes : input.groupScopes,
    passwordHash: input.password ? hashPassword(input.password) : current.passwordHash,
    updatedAt: now,
  };
  const next = [...users];
  next[index] = updated;
  await writeManagedUsers(next);
  return toPublic(updated, isLegacy);
}

export async function deleteManagedUser(username: string): Promise<void> {
  if (!isEdgeConfigWritable()) {
    throw new Error("Edge Config não está configurado para escrita. Veja as instruções em .env.example.");
  }
  const isLegacy = legacyUsernames().some((entry) => normalize(entry.user) === normalize(username));
  const users = await readManagedUsers();
  const next = users.filter((entry) => normalize(entry.user) !== normalize(username));
  if (next.length === users.length) {
    throw new Error("Usuário não encontrado.");
  }
  if (isLegacy) {
    // Para contas legadas, "remover" significa só voltar ao comportamento
    // padrão de hoje (sem overlay) — a conta continua existindo via env var.
    await writeManagedUsers(next);
    return;
  }
  await writeManagedUsers(next);
}
