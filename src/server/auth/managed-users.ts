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
import { validateStrongPassword } from "../../lib/password-policy";
import { isEdgeConfigWritable, readManagedUsers, writeManagedUsers } from "../config/edge-config-store";
import { validateDashboardCredentials } from "./credentials";
import { hashPassword, verifyPassword } from "./password";
import {
  buildTotpQrDataUrl,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp";

export type EffectiveDashboardAuth = {
  user: string;
  role: DashboardRole;
  allowedMenus: MenuId[] | null;
  isAdmin: boolean;
  groupScopes: string[] | null;
  partnerScopes: string[] | null;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  totpVerified: boolean;
};

export type TotpChallenge = {
  stage: "setup" | "verify";
  qrDataUrl?: string;
  manualKey?: string;
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

/** Escopos de dados do usuário — lidos do Edge Config (não vão no cookie). */
export async function getAccessScopesForUser(user: string): Promise<{
  groupScopes: string[] | null;
  partnerScopes: string[] | null;
}> {
  const managed = await findManagedUser(user);
  if (!managed) return { groupScopes: null, partnerScopes: null };
  return {
    groupScopes: managed.groupScopes ?? null,
    partnerScopes: managed.partnerScopes ?? null,
  };
}

function authFromManaged(managed: ManagedDashboardUser): EffectiveDashboardAuth {
  return {
    user: managed.user,
    role: managed.role,
    allowedMenus: managed.allowedMenus,
    isAdmin: managed.isAdmin,
    groupScopes: managed.groupScopes,
    partnerScopes: managed.partnerScopes,
    mustChangePassword: Boolean(managed.mustChangePassword),
    totpEnabled: Boolean(managed.totpEnabled),
    totpVerified: Boolean(managed.totpVerified),
  };
}

// Só usado no login: concilia a senha (env var OU hash salvo) com a
// permissão efetiva (overlay salvo OU baseline legado hoje em produção).
export async function resolveEffectiveAuth(user: string, password: string): Promise<EffectiveDashboardAuth | null> {
  const legacy = validateDashboardCredentials(user, password);
  const managed = await findManagedUser(user);
  if (legacy) {
    if (managed) {
      return {
        ...authFromManaged(managed),
        user: legacy.user,
        // Contas legadas autenticam pela env var — sem troca de senha / 2FA próprio.
        mustChangePassword: false,
        totpEnabled: false,
        totpVerified: false,
      };
    }
    return {
      user: legacy.user,
      role: legacy.role,
      allowedMenus: null,
      isAdmin: normalize(legacy.user) === "sanus",
      groupScopes: null,
      partnerScopes: null,
      mustChangePassword: false,
      totpEnabled: false,
      totpVerified: false,
    };
  }
  if (managed?.passwordHash && verifyPassword(password, managed.passwordHash)) {
    return authFromManaged(managed);
  }
  return null;
}

export async function getManagedAuthByUser(user: string): Promise<EffectiveDashboardAuth | null> {
  const managed = await findManagedUser(user);
  return managed?.passwordHash ? authFromManaged(managed) : null;
}

/** Prepara o desafio TOTP (gera secret/QR no setup, se ainda não existir). */
export async function prepareTotpChallenge(user: string): Promise<TotpChallenge> {
  if (!isEdgeConfigWritable()) {
    throw new Error("Edge Config não está configurado para escrita. Veja as instruções em .env.example.");
  }
  const users = await readManagedUsers();
  const index = users.findIndex((entry) => normalize(entry.user) === normalize(user));
  if (index < 0) throw new Error("Usuário não encontrado.");
  const current = users[index];
  if (!current.totpEnabled) throw new Error("Autenticador 2 fatores não está habilitado para este usuário.");

  if (current.totpVerified && current.totpSecret) {
    return { stage: "verify" };
  }

  let plainSecret: string;
  let next = users;
  if (current.totpSecret) {
    plainSecret = decryptTotpSecret(current.totpSecret);
  } else {
    plainSecret = generateTotpSecret();
    const updated: ManagedDashboardUser = {
      ...current,
      totpSecret: encryptTotpSecret(plainSecret),
      totpVerified: false,
      updatedAt: new Date().toISOString(),
    };
    next = [...users];
    next[index] = updated;
    await writeManagedUsers(next);
  }

  return {
    stage: "setup",
    qrDataUrl: await buildTotpQrDataUrl(current.user, plainSecret),
    manualKey: plainSecret,
  };
}

export async function completeTotpChallenge(user: string, code: string): Promise<EffectiveDashboardAuth> {
  const users = await readManagedUsers();
  const index = users.findIndex((entry) => normalize(entry.user) === normalize(user));
  if (index < 0) throw new Error("Usuário não encontrado.");
  const current = users[index];
  if (!current.totpEnabled || !current.totpSecret) {
    throw new Error("Autenticador 2 fatores não está configurado para este usuário.");
  }
  const plainSecret = decryptTotpSecret(current.totpSecret);
  if (!verifyTotpCode(plainSecret, code, current.user)) {
    throw new Error("Código do autenticador inválido ou expirado.");
  }

  if (!current.totpVerified) {
    const updated: ManagedDashboardUser = {
      ...current,
      totpVerified: true,
      updatedAt: new Date().toISOString(),
    };
    const next = [...users];
    next[index] = updated;
    await writeManagedUsers(next);
    return authFromManaged(updated);
  }

  return authFromManaged(current);
}

function toPublic(entry: ManagedDashboardUser, isLegacy: boolean): ManagedDashboardUserPublic {
  return {
    user: entry.user,
    role: entry.role,
    isAdmin: entry.isAdmin,
    allowedMenus: entry.allowedMenus,
    groupScopes: entry.groupScopes,
    partnerScopes: entry.partnerScopes,
    mustChangePassword: Boolean(entry.mustChangePassword),
    totpEnabled: Boolean(entry.totpEnabled),
    totpVerified: Boolean(entry.totpVerified),
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
            partnerScopes: null,
            mustChangePassword: false,
            totpEnabled: false,
            totpVerified: false,
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
  const strength = validateStrongPassword(input.password);
  if (strength.length) throw new Error(`Senha fraca: ${strength.join("; ")}`);

  const now = new Date().toISOString();
  const totpEnabled = Boolean(input.totpEnabled);
  const record: ManagedDashboardUser = {
    user: input.user.trim(),
    passwordHash: hashPassword(input.password),
    role: input.role,
    isAdmin: input.isAdmin,
    allowedMenus: input.allowedMenus,
    groupScopes: input.groupScopes ?? [],
    partnerScopes: input.partnerScopes ?? [],
    mustChangePassword: Boolean(input.mustChangePassword),
    totpEnabled,
    totpSecret: null,
    totpVerified: false,
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
    const legacy = legacyUsernames().find((entry) => normalize(entry.user) === normalize(username))!;
    const record: ManagedDashboardUser = {
      user: legacy.user,
      passwordHash: null,
      role: input.role ?? legacy.role,
      isAdmin: input.isAdmin ?? normalize(legacy.user) === "sanus",
      allowedMenus: input.allowedMenus ?? defaultAllowedMenusFor(input.role ?? legacy.role),
      groupScopes: input.groupScopes === undefined ? null : input.groupScopes,
      partnerScopes: input.partnerScopes === undefined ? null : input.partnerScopes,
      mustChangePassword: false,
      totpEnabled: false,
      totpSecret: null,
      totpVerified: false,
      createdAt: now,
      updatedAt: now,
    };
    if (input.password) throw new Error("Contas legadas (sanus/mds) mantêm a senha da env var; não é possível trocá-la aqui.");
    if (input.mustChangePassword) {
      throw new Error("Contas legadas não suportam troca de senha no próximo login.");
    }
    if (input.totpEnabled) {
      throw new Error("Contas legadas não suportam autenticador 2 fatores.");
    }
    await writeManagedUsers([...users, record]);
    return toPublic(record, true);
  }

  const current = users[index];
  if (isLegacy && input.password) {
    throw new Error("Contas legadas (sanus/mds) mantêm a senha da env var; não é possível trocá-la aqui.");
  }
  if (isLegacy && input.mustChangePassword) {
    throw new Error("Contas legadas não suportam troca de senha no próximo login.");
  }
  if (isLegacy && input.totpEnabled) {
    throw new Error("Contas legadas não suportam autenticador 2 fatores.");
  }
  if (input.password) {
    const strength = validateStrongPassword(input.password);
    if (strength.length) throw new Error(`Senha fraca: ${strength.join("; ")}`);
  }

  const nextTotpEnabled =
    input.totpEnabled === undefined ? Boolean(current.totpEnabled) : Boolean(input.totpEnabled);
  let totpSecret = current.totpSecret ?? null;
  let totpVerified = Boolean(current.totpVerified);
  if (!nextTotpEnabled) {
    totpSecret = null;
    totpVerified = false;
  } else if (!current.totpEnabled && nextTotpEnabled) {
    // Reativou 2FA: força novo pareamento no próximo login.
    totpSecret = null;
    totpVerified = false;
  }

  const updated: ManagedDashboardUser = {
    ...current,
    role: input.role ?? current.role,
    isAdmin: input.isAdmin ?? current.isAdmin,
    allowedMenus: input.allowedMenus === undefined ? current.allowedMenus : input.allowedMenus,
    groupScopes: input.groupScopes === undefined ? current.groupScopes : input.groupScopes,
    partnerScopes: input.partnerScopes === undefined ? current.partnerScopes : input.partnerScopes,
    mustChangePassword:
      input.mustChangePassword === undefined ? Boolean(current.mustChangePassword) : input.mustChangePassword,
    totpEnabled: nextTotpEnabled,
    totpSecret,
    totpVerified,
    passwordHash: input.password ? hashPassword(input.password) : current.passwordHash,
    updatedAt: now,
  };
  const next = [...users];
  next[index] = updated;
  await writeManagedUsers(next);
  return toPublic(updated, isLegacy);
}

// Troca obrigatória no login: valida a senha atual, exige mustChangePassword,
// aplica senha forte, limpa a flag e devolve o auth efetivo.
export async function changePasswordOnLogin(
  user: string,
  currentPassword: string,
  newPassword: string,
): Promise<EffectiveDashboardAuth> {
  if (!isEdgeConfigWritable()) {
    throw new Error("Edge Config não está configurado para escrita. Veja as instruções em .env.example.");
  }
  const strength = validateStrongPassword(newPassword);
  if (strength.length) throw new Error(`Senha fraca: ${strength.join("; ")}`);
  if (currentPassword === newPassword) {
    throw new Error("A nova senha precisa ser diferente da senha atual.");
  }

  const users = await readManagedUsers();
  const index = users.findIndex((entry) => normalize(entry.user) === normalize(user));
  if (index < 0) throw new Error("Usuário não encontrado.");
  const current = users[index];
  if (!current.passwordHash) {
    throw new Error("Esta conta não permite troca de senha por aqui.");
  }
  if (!verifyPassword(currentPassword, current.passwordHash)) {
    throw new Error("Usuário ou senha inválidos.");
  }
  if (!current.mustChangePassword) {
    throw new Error("Este usuário não está marcado para trocar a senha neste login.");
  }

  const now = new Date().toISOString();
  const updated: ManagedDashboardUser = {
    ...current,
    passwordHash: hashPassword(newPassword),
    mustChangePassword: false,
    updatedAt: now,
  };
  const next = [...users];
  next[index] = updated;
  await writeManagedUsers(next);
  return authFromManaged(updated);
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
    await writeManagedUsers(next);
    return;
  }
  await writeManagedUsers(next);
}
