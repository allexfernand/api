// Política de senha forte — compartilhada entre API e UI (sem node:crypto).
import { z } from "zod";

export const PASSWORD_MAX_LENGTH = 200;
export const PASSWORD_MIN_LENGTH = 10;

export type PasswordRule = {
  id: string;
  label: string;
  test: (password: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "upper",
    label: "Pelo menos 1 letra maiúscula (A–Z)",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lower",
    label: "Pelo menos 1 letra minúscula (a–z)",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "digit",
    label: "Pelo menos 1 número (0–9)",
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: "special",
    label: "Pelo menos 1 caractere especial (!@#$%&*…)",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

/** Lista de regras que falharam. Vazia = senha forte. */
export function validateStrongPassword(password: string): string[] {
  const errors = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label);
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Máximo de ${PASSWORD_MAX_LENGTH} caracteres`);
  }
  return errors;
}

export function strongPasswordIssues(password: string): string | null {
  const errors = validateStrongPassword(password);
  return errors.length ? errors.join("; ") : null;
}

export const strongPasswordSchema = z
  .string()
  .min(1, "Senha obrigatória")
  .max(PASSWORD_MAX_LENGTH)
  .superRefine((value, ctx) => {
    const errors = validateStrongPassword(value);
    if (errors.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: errors.join("; ") });
    }
  });
