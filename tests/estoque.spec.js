// Testes automáticos do sistema de estoque (abrem a página no Chromium e usam como um usuário)
const { test, expect } = require("@playwright/test");
const path = require("path");

const PAGINA = "file://" + path.join(__dirname, "..", "index.html");
const FIXTURES = path.join(__dirname, "fixtures");
const BIBLIOTECA = require.resolve("html5-qrcode/html5-qrcode.min.js");

// Data fixa: os dados de exemplo dependem de "hoje" (vencido / próximo do vencimento)
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-23T10:00:00-03:00"));
  // Serve a biblioteca de leitura localmente (os testes não dependem da internet)
  await page.route("**/html5-qrcode.min.js", route => route.fulfill({ path: BIBLIOTECA, contentType: "application/javascript" }));
  await page.goto(PAGINA);
});

const kpi = (page, nome) => page.locator("#kpis .kpi", { hasText: nome }).locator("strong");
const menu = (page, nome) => page.click(`.nav button[data-view="${nome}"]`);

async function novoProduto(page, dados) {
  await menu(page, "produtos");
  await page.click("#btn-novo");
  if (dados.codigo !== undefined) await page.fill("#p-codigo", dados.codigo);
  if (dados.descricao !== undefined) await page.fill("#p-descricao", dados.descricao);
  if (dados.lote !== undefined) await page.fill("#p-lote", dados.lote);
  if (dados.validade !== undefined) await page.fill("#p-validade", dados.validade);
  if (dados.caixas) {
    await page.check("#p-modo-caixas");
    await page.fill("#p-caixas", String(dados.caixas));
    await page.fill("#p-por-caixa", String(dados.porCaixa));
  } else if (dados.quantidade !== undefined) {
    await page.fill("#p-quantidade", String(dados.quantidade));
  }
  if (dados.minimo !== undefined) await page.fill("#p-minimo", String(dados.minimo));
  await page.click("#p-ok");
}

test.describe("Dashboard e alertas", () => {
  test("mostra os indicadores dos dados de exemplo", async ({ page }) => {
    await expect(kpi(page, "Produtos")).toHaveText("3");
    await expect(kpi(page, "Quantidade total")).toHaveText("60,5");
    await expect(kpi(page, "Estoque baixo")).toHaveText("1");
    await expect(kpi(page, "Próximos do vencimento")).toHaveText("1");
    await expect(kpi(page, "Vencidos")).toHaveText("1");
  });

  test("lista os itens que precisam de atenção (RN-01, RN-03)", async ({ page }) => {
    const itens = page.locator("#attention li");
    await expect(itens).toHaveCount(2);
    await expect(itens.filter({ hasText: "EX-LUB-02" })).toContainText("Próximo do vencimento");
    await expect(itens.filter({ hasText: "EX-LUB-02" })).toContainText("Estoque baixo");
    await expect(itens.filter({ hasText: "EX-RES-03" })).toContainText("Vencido");
    await expect(page.locator("#nav-badge")).toHaveText("2");
  });
});

test.describe("Cadastro de produtos (RF01, RF02, RN-07)", () => {
  test("cadastra um produto em pequenas quantidades", async ({ page }) => {
    await novoProduto(page, { codigo: "P-100", descricao: "Luva nitrílica", lote: "L-7", validade: "2027-05-01", quantidade: 4.5, minimo: 2 });
    await expect(page.locator("#dlg-prod")).not.toBeVisible();
    await expect(page.locator("#tbody tr", { hasText: "P-100" })).toContainText("4,5");
    await menu(page, "dashboard");
    await expect(kpi(page, "Produtos")).toHaveText("4");
  });

  test("cadastra por caixas: 10 caixas × 12 unidades = 120", async ({ page }) => {
    await menu(page, "produtos");
    await page.click("#btn-novo");
    await expect(page.locator("#p-caixas")).toBeDisabled();
    await page.check("#p-modo-caixas");
    await expect(page.locator("#p-caixas")).toBeEnabled();
    await expect(page.locator("#p-quantidade")).toBeDisabled();
    await page.fill("#p-caixas", "10");
    await page.fill("#p-por-caixa", "12");
    await expect(page.locator("#p-calc")).toContainText("120 unidades");
    await page.fill("#p-codigo", "CX-01");
    await page.fill("#p-descricao", "Parafuso M8");
    await page.fill("#p-lote", "L-1");
    await page.fill("#p-validade", "2028-01-01");
    await page.fill("#p-minimo", "20");
    await page.click("#p-ok");
    await expect(page.locator("#tbody tr", { hasText: "CX-01" }).locator("td").nth(2)).toHaveText("120");
  });

  test("exige o código do produto", async ({ page }) => {
    await novoProduto(page, { descricao: "Sem código", lote: "L", validade: "2027-01-01", quantidade: 1, minimo: 1 });
    await expect(page.locator("#p-erro")).toContainText("código");
  });

  test("não aceita código repetido", async ({ page }) => {
    await novoProduto(page, { codigo: "EX-LUB-02", descricao: "Outro", lote: "L", validade: "2027-01-01", quantidade: 1, minimo: 1 });
    await expect(page.locator("#p-erro")).toContainText("Já existe");
  });

  test("não aceita quantidade negativa", async ({ page }) => {
    await novoProduto(page, { codigo: "N-1", descricao: "Teste", lote: "L", validade: "2027-01-01", quantidade: -3, minimo: 1 });
    await expect(page.locator("#p-erro")).toContainText("negativas");
  });
});

test.describe("Movimentações (RF06, RF07, RN-01, RN-04, RF11)", () => {
  test("registra entrada e grava no histórico", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-CHA-01");
    await page.selectOption("#m-tipo", "entrada");
    await page.fill("#m-qtd", "5");
    await page.click("#form-mov-page button[type=submit]");
    await expect(page.locator("#m-saldo")).toContainText("45");
    await expect(page.locator("#hbody tr")).toHaveCount(1);
    await expect(page.locator("#hbody tr")).toContainText("Entrada");
  });

  test("recusa saída maior que o saldo (RN-04)", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-LUB-02");
    await page.selectOption("#m-tipo", "saida");
    await page.fill("#m-qtd", "100");
    await page.click("#form-mov-page button[type=submit]");
    await expect(page.locator("#m-erro")).toContainText("insuficiente");
  });

  test("bloqueia saída de produto vencido (RN-01)", async ({ page }) => {
    await menu(page, "produtos");
    await expect(page.locator('#tbody button[data-acao="saida"][data-cod="EX-RES-03"]')).toBeDisabled();
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-RES-03");
    await page.selectOption("#m-tipo", "saida");
    await page.fill("#m-qtd", "1");
    await page.click("#form-mov-page button[type=submit]");
    await expect(page.locator("#m-erro")).toContainText("vencido");
  });

  test("os dados continuam após recarregar a página", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-CHA-01");
    await page.fill("#m-qtd", "2");
    await page.click("#form-mov-page button[type=submit]");
    await page.reload();
    await menu(page, "movimentacoes");
    await expect(page.locator("#hbody tr")).toHaveCount(1);
  });
});

test.describe("Leitura de código de barras e QR code", () => {
  test("movimentação: QR code em foto identifica o produto", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.check("#m-modo-camera");
    await page.setInputFiles("#scan-foto", path.join(FIXTURES, "qr-EX-LUB-02.png"));
    await expect(page.locator("#scan-status")).toContainText("Produto identificado", { timeout: 10_000 });
    await expect(page.locator("#scan-status")).toContainText("EX-LUB-02");
    await page.selectOption("#m-tipo", "entrada");
    await page.fill("#m-qtd", "3");
    await page.click("#form-mov-page button[type=submit]");
    await expect(page.locator("#hbody tr")).toContainText("EX-LUB-02");
  });

  test("movimentação: código digitado que não existe oferece cadastro", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.check("#m-modo-camera");
    await page.fill("#scan-codigo", "XYZ-999");
    await page.press("#scan-codigo", "Enter");
    await expect(page.locator("#scan-status")).toContainText("não está cadastrado");
    await page.click("#scan-cadastrar");
    await expect(page.locator("#p-codigo")).toHaveValue("XYZ-999");
  });

  test("cadastro: código de barras EAN-13 em foto preenche o código", async ({ page }) => {
    await menu(page, "produtos");
    await page.click("#btn-novo");
    await page.setInputFiles("#p-foto", path.join(FIXTURES, "ean-7891000000014.png"));
    await expect(page.locator("#p-codigo")).toHaveValue("7891000000014", { timeout: 10_000 });
  });

  test("cadastro: câmera ao vivo (simulada) lê o código de barras", async ({ page }) => {
    await menu(page, "produtos");
    await page.click("#btn-novo-scan");
    await expect(page.locator("#p-codigo")).toHaveValue("7891000000014", { timeout: 20_000 });
    await expect(page.locator("#p-scan-status")).toContainText("Código lido");
    await expect(page.locator("#leitor-prod")).toBeHidden(); // a câmera fecha sozinha após a leitura
  });
});
