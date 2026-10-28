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

// Dados de exemplo (em 23/10/2026):
//   EX-CHA-01  lotes L-2026A (25, 30/12/2027) e L-2026B (15, 30/06/2028)  mínimo 10
//   EX-LUB-02  lote  L-LB77  (8,5, 10/11/2026 — próximo do vencimento)     mínimo 10 → estoque baixo
//   EX-RES-03  lotes L-99B   (4, 15/10/2026 — vencido) e L-120C (8, 01/03/2027)  mínimo 5

const kpi = (page, nome) => page.locator("#kpis .kpi", { hasText: nome }).locator("strong");
const menu = (page, nome) => page.click(`.nav button[data-view="${nome}"]`);
const linha = (page, cod) => page.locator("#tbody tr", { hasText: cod });
const disponivelNaTabela = (page, cod) => linha(page, cod).locator("td").nth(2);

async function novoProduto(page, dados) {
  await menu(page, "produtos");
  await page.click("#btn-novo");
  if (dados.codigo !== undefined) await page.fill("#p-codigo", dados.codigo);
  if (dados.descricao !== undefined) await page.fill("#p-descricao", dados.descricao);
  if (dados.minimo !== undefined) await page.fill("#p-minimo", String(dados.minimo));
  if (dados.lote !== undefined) await page.fill("#p-lote", dados.lote);
  if (dados.validade !== undefined) await page.fill("#p-validade", dados.validade);
  if (dados.caixas) {
    await page.check("#p-modo-caixas");
    await page.fill("#p-caixas", String(dados.caixas));
    await page.fill("#p-por-caixa", String(dados.porCaixa));
  } else if (dados.quantidade !== undefined) {
    await page.fill("#p-quantidade", String(dados.quantidade));
  }
  await page.click("#p-ok");
}

// Registra uma movimentação na tela Movimentações (modo manual)
async function movimentar(page, { cod, tipo, qtd, lote, validade }) {
  await menu(page, "movimentacoes");
  await page.selectOption("#m-produto", cod);
  await page.selectOption("#m-tipo", tipo);
  if (tipo === "entrada") {
    if (lote !== undefined) await page.fill("#m-lote", lote);
    if (validade !== undefined) await page.fill("#m-validade", validade);
  } else if (lote !== undefined) {
    await page.selectOption("#m-lote-saida", lote);
  }
  await page.fill("#m-qtd", String(qtd));
  await page.click("#form-mov-page button[type=submit]");
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
    await expect(itens.filter({ hasText: "EX-RES-03" })).toContainText("Lote vencido");
    await expect(page.locator("#nav-badge")).toHaveText("2");
  });

  test("a tela de alertas aponta o lote vencido", async ({ page }) => {
    await menu(page, "alertas");
    await expect(page.locator("#alert-full li", { hasText: "EX-RES-03" })).toContainText("Lote L-99B (4) venceu em 15/10/2026");
  });
});

test.describe("Lotes por produto", () => {
  test("a tabela mostra cada lote com quantidade e validade", async ({ page }) => {
    await menu(page, "produtos");
    await expect(linha(page, "EX-CHA-01").locator(".lote-linha")).toHaveText(["L-2026A · 25 · 30/12/2027", "L-2026B · 15 · 30/06/2028"]);
    // Disponível não conta o lote vencido
    await expect(disponivelNaTabela(page, "EX-RES-03")).toHaveText("8");
    await expect(linha(page, "EX-RES-03").locator(".lote-linha.vencido")).toContainText("L-99B");
  });

  test("entrada com lote novo cria um lote separado (RN-05)", async ({ page }) => {
    await movimentar(page, { cod: "EX-LUB-02", tipo: "entrada", qtd: 20, lote: "L-LB90", validade: "2027-08-01" });
    await expect(page.locator("#m-erro")).toBeHidden();
    await menu(page, "produtos");
    await expect(linha(page, "EX-LUB-02").locator(".lote-linha")).toHaveText(["L-LB77 · 8,5 · 10/11/2026", "L-LB90 · 20 · 01/08/2027"]);
    await expect(disponivelNaTabela(page, "EX-LUB-02")).toHaveText("28,5");
  });

  test("entrada em lote existente soma a quantidade", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "entrada", qtd: 5, lote: "L-2026A", validade: "2027-12-30" });
    await menu(page, "produtos");
    await expect(linha(page, "EX-CHA-01").locator(".lote-linha").first()).toHaveText("L-2026A · 30 · 30/12/2027");
  });

  test("digitar um lote existente preenche a validade dele", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-CHA-01");
    await page.fill("#m-lote", "L-2026B");
    await expect(page.locator("#m-validade")).toHaveValue("2028-06-30");
  });

  test("recusa o mesmo lote com outra validade", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "entrada", qtd: 5, lote: "L-2026A", validade: "2029-01-01" });
    await expect(page.locator("#m-erro")).toContainText("já está cadastrado com validade 30/12/2027");
  });

  test("entrada exige lote e validade", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "entrada", qtd: 5 });
    await expect(page.locator("#m-erro")).toContainText("lote e a data de validade");
  });

  test("não aceita entrada de lote já vencido", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "entrada", qtd: 5, lote: "L-VELHO", validade: "2026-01-01" });
    await expect(page.locator("#m-erro")).toContainText("já vencido");
  });
});

test.describe("Saídas e descarte (RN-01, RN-04)", () => {
  test("saída automática tira primeiro do lote que vence antes (PVPS)", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "saida", qtd: 30 });
    await expect(page.locator("#m-erro")).toBeHidden();
    // 25 do L-2026A (vence antes) + 5 do L-2026B
    await expect(page.locator("#hbody tr")).toHaveCount(2);
    await expect(page.locator("#hbody tr").nth(1)).toContainText("L-2026A");
    await expect(page.locator("#hbody tr").nth(1)).toContainText("25");
    await expect(page.locator("#hbody tr").nth(0)).toContainText("L-2026B");
    await menu(page, "produtos");
    await expect(linha(page, "EX-CHA-01").locator(".lote-linha")).toHaveText(["L-2026B · 10 · 30/06/2028"]);
  });

  test("saída de um lote escolhido", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "saida", qtd: 3, lote: "L-2026B" });
    await expect(page.locator("#hbody tr").first()).toContainText("L-2026B");
    await menu(page, "produtos");
    await expect(linha(page, "EX-CHA-01").locator(".lote-linha").nth(1)).toHaveText("L-2026B · 12 · 30/06/2028");
  });

  test("lote vencido não aparece como opção de saída (RN-01)", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-RES-03");
    await page.selectOption("#m-tipo", "saida");
    const opcoes = await page.locator("#m-lote-saida option").allTextContents();
    expect(opcoes.join(" ")).toContain("L-120C");
    expect(opcoes.join(" ")).not.toContain("L-99B");
  });

  test("recusa saída maior que o disponível, sem contar lote vencido (RN-04)", async ({ page }) => {
    // Resina tem 12 no total, mas só 8 dentro da validade
    await movimentar(page, { cod: "EX-RES-03", tipo: "saida", qtd: 10 });
    await expect(page.locator("#m-erro")).toContainText("Disponível nos lotes dentro da validade: 8");
  });

  test("descarte de lote vencido resolve o alerta", async ({ page }) => {
    await movimentar(page, { cod: "EX-RES-03", tipo: "descarte", qtd: 4, lote: "L-99B" });
    await expect(page.locator("#m-erro")).toBeHidden();
    await expect(page.locator("#hbody tr").first()).toContainText("Descarte");
    await menu(page, "dashboard");
    await expect(kpi(page, "Vencidos")).toHaveText("0");
  });

  test("descarte só aceita lote vencido", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-CHA-01");
    await page.selectOption("#m-tipo", "descarte");
    await expect(page.locator("#m-lote-saida option")).toHaveText(["Nenhum lote vencido neste produto"]);
  });

  test("botão de saída fica desativado sem lote dentro da validade", async ({ page }) => {
    await movimentar(page, { cod: "EX-LUB-02", tipo: "saida", qtd: 8.5 });
    await menu(page, "produtos");
    await expect(page.locator('#tbody button[data-acao="saida"][data-cod="EX-LUB-02"]')).toBeDisabled();
  });

  test("botão “+ Entrada” da tabela abre Movimentações já preenchida", async ({ page }) => {
    await menu(page, "produtos");
    await page.click('#tbody button[data-acao="entrada"][data-cod="EX-RES-03"]');
    await expect(page.locator("#view-movimentacoes")).toBeVisible();
    await expect(page.locator("#m-produto")).toHaveValue("EX-RES-03");
    await expect(page.locator("#m-tipo")).toHaveValue("entrada");
  });
});

test.describe("Cadastro de produtos (RF01, RF02, RN-07)", () => {
  test("cadastra um produto com o primeiro lote", async ({ page }) => {
    await novoProduto(page, { codigo: "P-100", descricao: "Luva nitrílica", minimo: 2, lote: "L-7", validade: "2027-05-01", quantidade: 4.5 });
    await expect(page.locator("#dlg-prod")).not.toBeVisible();
    await expect(linha(page, "P-100").locator(".lote-linha")).toHaveText("L-7 · 4,5 · 01/05/2027");
    await menu(page, "movimentacoes");
    await expect(page.locator("#hbody tr").first()).toContainText("P-100");
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
    await page.fill("#p-minimo", "20");
    await page.fill("#p-lote", "L-1");
    await page.fill("#p-validade", "2028-01-01");
    await page.click("#p-ok");
    await expect(disponivelNaTabela(page, "CX-01")).toHaveText("120");
  });

  test("exige o código do produto", async ({ page }) => {
    await novoProduto(page, { descricao: "Sem código", minimo: 1, lote: "L", validade: "2027-01-01", quantidade: 1 });
    await expect(page.locator("#p-erro")).toContainText("código");
  });

  test("não aceita código repetido", async ({ page }) => {
    await novoProduto(page, { codigo: "EX-LUB-02", descricao: "Outro", minimo: 1, lote: "L", validade: "2027-01-01", quantidade: 1 });
    await expect(page.locator("#p-erro")).toContainText("Já existe");
  });

  test("exige lote e validade do primeiro lote", async ({ page }) => {
    await novoProduto(page, { codigo: "N-1", descricao: "Teste", minimo: 1, quantidade: 1 });
    await expect(page.locator("#p-erro")).toContainText("lote e a validade");
  });

  test("não aceita quantidade negativa", async ({ page }) => {
    await novoProduto(page, { codigo: "N-1", descricao: "Teste", minimo: 1, lote: "L", validade: "2027-01-01", quantidade: -3 });
    await expect(page.locator("#p-erro")).toContainText("negativas");
  });

  test("editar altera descrição e mínimo e mostra os lotes", async ({ page }) => {
    await menu(page, "produtos");
    await page.click('#tbody button[data-acao="editar"][data-cod="EX-CHA-01"]');
    await expect(page.locator("#p-lote")).toBeHidden();
    await expect(page.locator("#p-lotes-info")).toContainText("L-2026B");
    await page.fill("#p-minimo", "50");
    await page.click("#p-ok");
    await expect(linha(page, "EX-CHA-01")).toContainText("Estoque baixo");
  });
});

test.describe("Dados salvos no navegador", () => {
  test("os dados continuam após recarregar a página", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "saida", qtd: 2 });
    await page.reload();
    await menu(page, "movimentacoes");
    await expect(page.locator("#hbody tr")).toHaveCount(1);
  });

  test("converte os dados da versão anterior (um lote por produto)", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem("estoque-senai-v3");
      localStorage.setItem("estoque-senai-v2", JSON.stringify({
        estoque: { "OLD-1": { descricao: "Produto antigo", quantidade: 7, lote: "L-A", validade: "2027-02-02", estoque_minimo: 1 } },
        historico: [], diasAviso: 30
      }));
    });
    await page.reload();
    await menu(page, "produtos");
    await expect(linha(page, "OLD-1").locator(".lote-linha")).toHaveText("L-A · 7 · 02/02/2027");
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
    await page.fill("#m-lote", "L-LB77");
    await expect(page.locator("#m-validade")).toHaveValue("2026-11-10");
    await page.fill("#m-qtd", "3");
    await page.click("#form-mov-page button[type=submit]");
    await expect(page.locator("#hbody tr").first()).toContainText("EX-LUB-02");
    await expect(page.locator("#hbody tr").first()).toContainText("L-LB77");
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
