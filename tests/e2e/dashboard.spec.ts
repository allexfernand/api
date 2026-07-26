import { expect, test } from "@playwright/test";

// As onze abas atuais (navSections em DashboardShell.tsx), na mesma ordem de
// seção. `preview-gold` foi removida nesta consolidação (a Análise Sinistro
// passou a renderizar, sobre a Gold, o mesmo conteúdo que a Preview Gold
// usava) — navegação foi de 12 para 11 abas. Os rótulos batem com o texto
// acessível real dos botões (sem o prefixo "Qualidade ·": esse é só o
// cabeçalho da seção na sidebar, não faz parte do nome do botão).
const tabs = [
  ["Análise Demográfica", "demografica"],
  ["Visão Parceiros", "visao-parceiros"],
  ["Agendamentos", "agendamentos"],
  ["Sessões", "sessoes"],
  ["Petit Comitê", "petit-comite"],
  ["Petit Comitê MDS", "petit-comite-mds"],
  ["Coordenação de Cuidado", "coordenacao-cuidado"],
  ["Análise Sinistro", "analise-sinistro"],
  ["Visão 360", "sinistralidade-v2"],
  ["Estratégica", "qualidade-estrategica"],
  ["Operacional", "qualidade-operacional"],
] as const;

test("autentica com cookie HttpOnly e navega pelas onze áreas", async ({ page }) => {
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

  // A seção "Sinistralidade" tem exatamente estas duas abas, e a antiga
  // Preview Gold não existe mais em lugar nenhum da navegação.
  await expect(page.locator('[data-tab="analise-sinistro"]')).toHaveCount(1);
  await expect(page.locator('[data-tab="sinistralidade-v2"]')).toHaveCount(1);
  await expect(page.locator('[data-tab="preview-gold"]')).toHaveCount(0);
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

test("Análise Sinistro carrega da Gold, filtra e abre linhagem", async ({ page }) => {
  // Mesmo motivo do teste acima: a consulta bate no warehouse Databricks e o
  // filtro de faceta dispara uma segunda consulta — 30s de padrão não sobra.
  test.setTimeout(120_000);

  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill(process.env.DASHBOARD_AUTH_USER || "");
  await page.getByLabel("Senha", { exact: true }).fill(process.env.DASHBOARD_AUTH_PASSWORD || "");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("body")).not.toHaveClass(/auth-locked/);
  await expect(page.locator("#status")).toContainText("Dados ao vivo", { timeout: 20_000 });

  const abaSinistro = page.locator("#tab-analise-sinistro");

  await page.click('[data-tab="analise-sinistro"]');

  // KPIs vêm da API; timeout largo porque a consulta bate no Databricks.
  const kpis = abaSinistro.getByText(/Sinistro · último mês fechado/);
  await expect(kpis).toBeVisible({ timeout: 60_000 });

  // Bug de transcrição real desta consolidação (ver Concentration.tsx):
  // "Top 10 juntos" chegou a mostrar 12,9% (razão recalculada a partir do
  // sinistro bruto) contra 13,0% na aba de referência (soma do share que já
  // vem pronto por linha, igual ao script legado). Cravar "13,0%" pegava essa
  // regressão, mas só enquanto a Silver ficasse congelada nesta janela — a
  // próxima ingestão manual mudaria o número e deixaria o CI vermelho por um
  // motivo que não é bug. O invariante sobrevive ao refresh e pega a MESMA
  // regressão: o total do rodapé precisa bater com a SOMA do share de cada
  // prestador da tabela (a mesma conta de Concentration.tsx `shareTop`).
  const prestadoresCard = abaSinistro
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Top prestadores", level: 3 }) });
  const shareCelulas = await prestadoresCard.locator("tbody tr td:nth-child(3)").allTextContents();
  const rodapeTexto = await prestadoresCard.getByText(/Top \d+ juntos =/).textContent();

  const paraNumero = (texto: string): number | null => {
    const limpo = texto.trim();
    if (limpo === "—" || limpo === "") return null;
    return Number(limpo.replace("%", "").replace(",", "."));
  };

  const shares = shareCelulas.map(paraNumero);
  const somaShares = shares.some((valor) => valor === null)
    ? null
    : shares.reduce<number>((total, valor) => total + (valor as number), 0);
  const rodapeMatch = rodapeTexto?.match(/Top \d+ juntos = ([\d.,]+|—)%?/);
  const rodapeValor = rodapeMatch ? paraNumero(rodapeMatch[1]) : null;

  if (somaShares === null || rodapeValor === null) {
    // Nenhum prestador com share nulo é esperado na base atual — se acontecer,
    // o rodapé precisa concordar (também "—"), nunca inventar um número.
    expect(rodapeValor).toBeNull();
    expect(somaShares).toBeNull();
  } else {
    // Tolerância só para ruído de ponto flutuante: os valores por linha já
    // chegam com 1 casa decimal do servidor, então a soma bate com o rodapé a
    // menos de 0,05 — folgado o bastante para float, apertado o bastante para
    // pegar de novo a regressão real (12,9% recalculado vs 13,0% somado, uma
    // diferença de 0,1).
    expect(Math.abs(somaShares - rodapeValor)).toBeLessThan(0.05);
  }

  // Bug de cascata do CSS desta consolidação: `ClaimsTab.module.css .root`
  // chegou a forçar display:flex incondicionalmente e vencia a regra global
  // `.tab-content{display:none}` — a aba ficava sempre visível, empilhada
  // sobre qualquer aba ativa. Neste ponto o conteúdo já carregou de verdade
  // (o KPI acima está montado), então trocar de aba e checar que ele some é
  // uma checagem real de que o CSS esconde a aba inativa, não um falso
  // positivo por a consulta ainda não ter respondido.
  await page.click('[data-tab="demografica"]');
  await expect(abaSinistro).toBeHidden();

  await page.click('[data-tab="analise-sinistro"]');
  await expect(kpis).toBeVisible();

  // A aba não existe mais na navegação.
  await expect(page.locator('[data-tab="preview-gold"]')).toHaveCount(0);

  // Filtro de faceta: recorta por sexo e confirma que os blocos recalculam.
  // O valor absoluto de utilizantes (25.271 -> 13.098 na base atual) só vale
  // enquanto a Silver ficar congelada nesta janela; o invariante que sobrevive
  // a um refresh é que filtrar por UM sexo só pode manter ou reduzir a
  // população de utilizantes, nunca aumentar. "Aplicar recorte" troca o
  // status da aba para "loading" enquanto a nova consulta roda — igual à
  // carga inicial, o conteúdo inteiro (painel de facetas incluso) some até a
  // resposta chegar — por isso o gate de prontidão é o chip "Sexo: Feminino",
  // que só existe depois do remount em "ready".
  const utilizantesHelper = abaSinistro.getByText(/utilizantes · não é per capita/);
  const utilizantesTextoInicial = (await utilizantesHelper.textContent()) ?? "";
  const utilizantesInicial = Number(utilizantesTextoInicial.replace(/\D/g, ""));

  await page.locator("#claims-filter-trigger-sexo").click();
  await abaSinistro.getByRole("button", { name: "Feminino", exact: true }).click();
  await abaSinistro.getByRole("button", { name: "Aplicar recorte" }).click();
  await expect(abaSinistro.getByText("Sexo: Feminino")).toBeVisible({ timeout: 60_000 });

  const utilizantesTextoFiltrado = (await utilizantesHelper.textContent()) ?? "";
  const utilizantesFiltrado = Number(utilizantesTextoFiltrado.replace(/\D/g, ""));
  expect(utilizantesFiltrado).toBeLessThan(utilizantesInicial);

  // Modo de linhagem: o selo aparece e a gaveta abre com a fonte certa.
  // Não usa `.first()`: o cabeçalho (claims.freshness) tem seu próprio selo
  // de linhagem, ANTES dos KPIs no DOM, e sua fonte é a Silver, não a Gold —
  // `.first()` pegaria esse selo e quebraria a asserção abaixo. Mira direto
  // no selo do primeiro KPI, cuja fonte é gold_sinistro_evento_v2.
  const toggle = page.getByRole("button", { name: "Análise Databricks" });
  await expect(toggle).toBeVisible();
  await toggle.click();

  const selo = abaSinistro.getByRole("button", { name: /Ver linhagem Databricks de Sinistro · último mês fechado/ });
  await selo.click();

  const gaveta = page.getByRole("complementary", { name: "Linhagem Databricks" });
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("gold_sinistro_evento_v2");
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
