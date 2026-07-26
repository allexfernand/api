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
  await expect(page.locator("#status")).toContainText("Dados ao vivo", { timeout: 20_000 });

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
  try {
    await expect(custoKpi).toBeVisible({ timeout: 60_000 });
  } catch (cause) {
    // Timeout sozinho não diz se o recurso quebrou ou se o bloco `timeline`
    // simplesmente não teve dado/gate para esta empresa — diagnóstico rápido
    // antes de propagar o erro original do Playwright.
    const bloqueado = await page.getByText("Período bloqueado pelo gate de fechamento.").isVisible().catch(() => false);
    const comErro = await page.getByText("Não foi possível carregar este bloco.").isVisible().catch(() => false);
    if (bloqueado) throw new Error("Bloco `timeline` bloqueado pelo gate de fechamento para a empresa/mês padrão — não é uma quebra do modo de linhagem.");
    if (comErro) throw new Error("Bloco `timeline` falhou ao consultar o Databricks — verifique credenciais/warehouse antes de suspeitar do modo de linhagem.");
    throw cause;
  }

  // O botão "Ver tabela" do ChartCard continua funcionando e não abre a
  // gaveta: o selo de linhagem é um alvo clicável separado, não um wrapper
  // que capturaria o clique dos controles internos do card (decisão de
  // design registrada em LineageAnchor.tsx — nesting de controles interativos
  // foi rejeitado).
  const verTabela = page.getByRole("button", { name: "Ver tabela" }).first();
  await verTabela.click();
  await expect(page.getByRole("complementary", { name: "Linhagem Databricks" })).toHaveCount(0);
  // Depois do clique, o mesmo card lê "Ver gráfico": reusar o locator "Ver
  // tabela".first() aqui resolveria para um SEGUNDO card, não restauraria o
  // primeiro. Precisa seguir o rótulo que o card mudou para.
  const verGrafico = page.getByRole("button", { name: "Ver gráfico" }).first();
  await verGrafico.click();

  await custoKpi.click();
  const gaveta = page.getByRole("complementary", { name: "Linhagem Databricks" });
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("mart_sinistro_empresa_mes_v2");
  await expect(gaveta).toContainText("custo_assistencial_bruto");

  // Trocar de alvo mantém a gaveta aberta e troca o conteúdo: é não-modal de
  // propósito, para permitir comparar a origem de dois blocos sem reabrir.
  // O segundo KPI (episódios de internação) já está montado no mesmo bloco
  // `timeline`, então a troca não depende de uma nova consulta.
  //
  // `toBeVisible`/`toContainText` sozinhos não provam continuidade: como
  // locators do Playwright fazem auto-retry, uma implementação que fechasse a
  // gaveta e a reabrisse para o novo id (uma transição saída/entrada, ou um
  // remount por `key`) passaria nas duas do mesmo jeito, porque no momento em
  // que elas resolvem a gaveta já está visível de novo com o conteúdo novo.
  // Por isso capturamos o node real antes da troca e confirmamos que ele
  // nunca saiu do DOM — é o `<aside>` original que trocou de conteúdo, não um
  // novo `<aside>` que apareceu no lugar.
  const gavetaNode = await gaveta.elementHandle();
  if (!gavetaNode) throw new Error("Gaveta de linhagem sem elemento no DOM antes da troca de alvo.");

  await page.getByRole("button", { name: "Ver linhagem Databricks de Episódios de internação" }).click();
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("mart_internacao_mes_v2");
  expect(await gavetaNode.evaluate((el) => el.isConnected)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(gaveta).toBeHidden();
});
