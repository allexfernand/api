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

test("modo Análise Databricks revela a linhagem de um bloco e troca de alvo sem fechar a gaveta", async ({ page }) => {
  // As consultas desta aba vão ao warehouse Databricks (a rota tem timeout de
  // 55s); o padrão de 30s do Playwright para o teste inteiro não sobra.
  test.setTimeout(120_000);

  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill(process.env.DASHBOARD_AUTH_USER || "");
  await page.getByLabel("Senha", { exact: true }).fill(process.env.DASHBOARD_AUTH_PASSWORD || "");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("body")).not.toHaveClass(/auth-locked/);

  await page.click('[data-tab="sinistralidade-v2"]');

  const toggle = page.getByRole("button", { name: "Análise Databricks" });
  await expect(toggle).toBeVisible({ timeout: 30_000 });

  // Modo desligado: nenhum alvo de linhagem no DOM. `LineageAnchor` devolve os
  // filhos sem envoltório quando o modo está desligado, então o DOM dos cards
  // fica idêntico ao de hoje — é a asserção central do critério de aceite
  // "com o modo desligado, o DOM dos cards é idêntico ao de hoje".
  await expect(page.getByRole("button", { name: /Ver linhagem Databricks de/ })).toHaveCount(0);

  await toggle.click();

  // KPI executivo de custo: primeiro alvo a aparecer quando o bloco `timeline`
  // resolve. A consulta ao warehouse leva segundos — timeout generoso em vez
  // de sleep arbitrário.
  const custoKpi = page.getByRole("button", { name: "Ver linhagem Databricks de Custo assistencial (janela)" });
  await expect(custoKpi).toBeVisible({ timeout: 60_000 });

  // O botão "Ver tabela" do ChartCard continua funcionando e não abre a
  // gaveta: o selo de linhagem é um alvo clicável separado, não um wrapper
  // que capturaria o clique dos controles internos do card (decisão de
  // design registrada em LineageAnchor.tsx — nesting de controles interativos
  // foi rejeitado).
  const verTabela = page.getByRole("button", { name: "Ver tabela" }).first();
  await verTabela.click();
  await expect(page.getByRole("complementary", { name: "Linhagem Databricks" })).toHaveCount(0);
  await verTabela.click();

  await custoKpi.click();
  const gaveta = page.getByRole("complementary", { name: "Linhagem Databricks" });
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("mart_sinistro_empresa_mes_v2");
  await expect(gaveta).toContainText("custo_assistencial_bruto");

  // Trocar de alvo mantém a gaveta aberta e troca o conteúdo: é não-modal de
  // propósito, para permitir comparar a origem de dois blocos sem reabrir.
  // O segundo KPI (episódios de internação) já está montado no mesmo bloco
  // `timeline`, então a troca não depende de uma nova consulta.
  await page.getByRole("button", { name: "Ver linhagem Databricks de Episódios de internação" }).click();
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("mart_internacao_mes_v2");

  await page.keyboard.press("Escape");
  await expect(gaveta).toBeHidden();
});
