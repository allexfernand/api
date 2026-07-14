import { expect, test } from "@playwright/test";

const tabs = [
  ["Análise Demográfica", "demografica"],
  ["Agendamentos", "agendamentos"],
  ["Coordenação de Cuidado", "coordenacao-cuidado"],
  ["Sessões", "sessoes"],
  ["Petit Comitê", "petit-comite"],
  ["Petit Comitê MDS", "petit-comite-mds"],
  ["Análise Sinistro", "analise-sinistro"],
  ["PREVIEW-gold", "preview-gold"],
  ["Qualidade · Estratégica", "qualidade-estrategica"],
  ["Qualidade · Operacional", "qualidade-operacional"],
] as const;

test("autentica com cookie HttpOnly e navega pelas dez áreas", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill(process.env.DASHBOARD_AUTH_USER || "");
  await page.getByLabel("Senha", { exact: true }).fill(process.env.DASHBOARD_AUTH_PASSWORD || "");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("body")).not.toHaveClass(/auth-locked/);
  await expect(page.locator("#status")).toContainText("Dados ao vivo", { timeout: 20_000 });

  for (const [label, id] of tabs) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(`.tab[data-tab="${id}"]`)).toHaveClass(/active/);
    await expect(page.locator(`#tab-${id}`)).toHaveClass(/active/);
  }
});
