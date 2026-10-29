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
// O histórico de exemplo tem 16 movimentações nos últimos 6 meses (ver HIST_EXEMPLO no index.html).
const HIST_INICIAL = 16;

const kpi = (page, nome) => page.locator("#kpis .kpi", { hasText: nome }).locator("strong");
const menu = (page, nome) => page.click(`.nav button[data-view="${nome}"]`);
const linha = (page, cod) => page.locator("#tbody tr", { hasText: cod });
const disponivelNaTabela = (page, cod) => linha(page, cod).locator("td").nth(2);

async function novoProduto(page, dados) {
  await menu(page, "cadastro");
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
    await menu(page, "consulta");
    await expect(linha(page, "EX-CHA-01").locator(".lote-linha")).toHaveText(["L-2026A · 25 · 30/12/2027", "L-2026B · 15 · 30/06/2028"]);
    // Disponível não conta o lote vencido
    await expect(disponivelNaTabela(page, "EX-RES-03")).toHaveText("8");
    await expect(linha(page, "EX-RES-03").locator(".lote-linha.vencido")).toContainText("L-99B");
  });

  test("entrada com lote novo cria um lote separado (RN-05)", async ({ page }) => {
    await movimentar(page, { cod: "EX-LUB-02", tipo: "entrada", qtd: 20, lote: "L-LB90", validade: "2027-08-01" });
    await expect(page.locator("#m-erro")).toBeHidden();
    await menu(page, "consulta");
    await expect(linha(page, "EX-LUB-02").locator(".lote-linha")).toHaveText(["L-LB77 · 8,5 · 10/11/2026", "L-LB90 · 20 · 01/08/2027"]);
    await expect(disponivelNaTabela(page, "EX-LUB-02")).toHaveText("28,5");
  });

  test("entrada em lote existente soma a quantidade", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "entrada", qtd: 5, lote: "L-2026A", validade: "2027-12-30" });
    await menu(page, "consulta");
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
    await expect(page.locator("#hbody tr")).toHaveCount(HIST_INICIAL + 2);
    await expect(page.locator("#hbody tr").nth(1)).toContainText("L-2026A");
    await expect(page.locator("#hbody tr").nth(1)).toContainText("25");
    await expect(page.locator("#hbody tr").nth(0)).toContainText("L-2026B");
    await menu(page, "consulta");
    await expect(linha(page, "EX-CHA-01").locator(".lote-linha")).toHaveText(["L-2026B · 10 · 30/06/2028"]);
  });

  test("saída de um lote escolhido", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "saida", qtd: 3, lote: "L-2026B" });
    await expect(page.locator("#hbody tr").first()).toContainText("L-2026B");
    await menu(page, "consulta");
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
    await menu(page, "consulta");
    await expect(page.locator('#tbody button[data-acao="saida"][data-cod="EX-LUB-02"]')).toBeDisabled();
  });

  test("botão “+ Entrada” da tabela abre Movimentações já preenchida", async ({ page }) => {
    await menu(page, "consulta");
    await page.click('#tbody button[data-acao="entrada"][data-cod="EX-RES-03"]');
    await expect(page.locator("#view-movimentacoes")).toBeVisible();
    await expect(page.locator("#m-produto")).toHaveValue("EX-RES-03");
    await expect(page.locator("#m-tipo")).toHaveValue("entrada");
  });
});

test.describe("Cadastro de produtos (RF01, RF02, RN-07)", () => {
  test("cadastra um produto com o primeiro lote", async ({ page }) => {
    await novoProduto(page, { codigo: "P-100", descricao: "Luva nitrílica", minimo: 2, lote: "L-7", validade: "2027-05-01", quantidade: 4.5 });
    await expect(page.locator("#cad-sucesso")).toContainText("P-100 · Luva nitrílica");
    await page.click("#cad-ver");
    await expect(page.locator("#view-consulta")).toBeVisible();
    await expect(page.locator("#tbody tr")).toHaveCount(1);
    await expect(linha(page, "P-100").locator(".lote-linha")).toHaveText("L-7 · 4,5 · 01/05/2027");
    await menu(page, "movimentacoes");
    await expect(page.locator("#hbody tr").first()).toContainText("P-100");
    await menu(page, "dashboard");
    await expect(kpi(page, "Produtos")).toHaveText("4");
  });

  test("cadastra por caixas: 10 caixas × 12 unidades = 120", async ({ page }) => {
    await menu(page, "cadastro");
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
    await menu(page, "consulta");
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
    await expect(page.locator("#hbody tr")).toHaveCount(HIST_INICIAL + 1);
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
    await menu(page, "consulta");
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
    await expect(page.locator("#view-cadastro")).toBeVisible();
    await expect(page.locator("#p-codigo")).toHaveValue("XYZ-999");
  });

  test("cadastro: código de barras EAN-13 em foto preenche o código", async ({ page }) => {
    await menu(page, "cadastro");
    await page.setInputFiles("#p-foto", path.join(FIXTURES, "ean-7891000000014.png"));
    await expect(page.locator("#p-codigo")).toHaveValue("7891000000014", { timeout: 10_000 });
  });

  test("cadastro: câmera ao vivo (simulada) lê o código de barras", async ({ page }) => {
    await menu(page, "cadastro");
    await page.check("#cad-modo-ler");
    await expect(page.locator("#p-codigo")).toHaveValue("7891000000014", { timeout: 20_000 });
    await expect(page.locator("#p-scan-status")).toContainText("Código lido");
    await expect(page.locator("#leitor-prod")).toBeHidden(); // a câmera fecha sozinha após a leitura
  });
});

test.describe("Fornecedores", () => {
  const linhaForn = (page, texto) => page.locator("#fbody tr", { hasText: texto });

  async function novoFornecedor(page, f) {
    await menu(page, "fornecedores");
    await page.click("#btn-novo-forn");
    for (const k of ["nome", "cnpj", "telefone", "email", "endereco"]) if (f[k] !== undefined) await page.fill("#f-" + k, f[k]);
    await page.click("#f-ok");
  }

  test("lista os fornecedores de exemplo", async ({ page }) => {
    await menu(page, "fornecedores");
    await expect(page.locator("#fbody tr")).toHaveCount(2);
    await expect(linhaForn(page, "Aços Paulista")).toContainText("11.222.333/0001-81");
  });

  test("cadastra fornecedor e formata o CNPJ", async ({ page }) => {
    await novoFornecedor(page, { nome: "Ferragens Sul", cnpj: "11444777000161", telefone: "(51) 3333-0000", email: "contato@ferragenssul.com.br", endereco: "Rua A, 10 – Porto Alegre/RS" });
    await expect(page.locator("#dlg-forn")).not.toBeVisible();
    await expect(linhaForn(page, "Ferragens Sul")).toContainText("11.444.777/0001-61");
    await expect(linhaForn(page, "Ferragens Sul")).toContainText("contato@ferragenssul.com.br");
  });

  test("exige o nome", async ({ page }) => {
    await novoFornecedor(page, { cnpj: "11444777000161" });
    await expect(page.locator("#f-erro")).toContainText("nome");
  });

  test("recusa CNPJ inválido", async ({ page }) => {
    await novoFornecedor(page, { nome: "Teste", cnpj: "11.222.333/0001-82" });
    await expect(page.locator("#f-erro")).toContainText("CNPJ inválido");
  });

  test("recusa CNPJ já cadastrado", async ({ page }) => {
    await novoFornecedor(page, { nome: "Outro", cnpj: "11222333000181" });
    await expect(page.locator("#f-erro")).toContainText("já está cadastrado para Aços Paulista");
  });

  test("recusa e-mail inválido", async ({ page }) => {
    await novoFornecedor(page, { nome: "Teste", cnpj: "11444777000161", email: "contato@semponto" });
    await expect(page.locator("#f-erro")).toContainText("E-mail inválido");
  });

  test("edita os dados do fornecedor", async ({ page }) => {
    await menu(page, "fornecedores");
    await linhaForn(page, "Química Central").locator('button[data-forn-acao="editar"]').click();
    await expect(page.locator("#f-cnpj")).toHaveValue("45.723.174/0001-10");
    await page.fill("#f-telefone", "(19) 9999-1111");
    await page.click("#f-ok");
    await expect(linhaForn(page, "Química Central")).toContainText("(19) 9999-1111");
  });

  test("pesquisa por parte do CNPJ", async ({ page }) => {
    await menu(page, "fornecedores");
    await page.fill("#busca-forn", "45723");
    await expect(page.locator("#fbody tr")).toHaveCount(1);
    await expect(page.locator("#fbody tr")).toContainText("Química Central");
  });

  test("entrada com fornecedor e custo entra no histórico de fornecimento", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-CHA-01");
    await page.selectOption("#m-tipo", "entrada");
    await page.fill("#m-lote", "L-2027X");
    await page.fill("#m-validade", "2029-01-01");
    await page.selectOption("#m-fornecedor", { label: "Aços Paulista Ltda." });
    await page.fill("#m-custo", "5");
    await page.fill("#m-qtd", "20");
    await page.click("#form-mov-page button[type=submit]");
    await expect(page.locator("#m-erro")).toBeHidden();
    await expect(page.locator("#hbody tr").first()).toContainText("Aços Paulista Ltda.");
    await expect(page.locator("#hbody tr").first()).toContainText(/R\$\s?5,00/);

    await menu(page, "fornecedores");
    const l = linhaForn(page, "Aços Paulista");
    // Exemplo: 2 entregas (60 × R$ 85,00 + 15 × R$ 87,50 = R$ 6.412,50); mais esta de R$ 100,00
    await expect(l.locator("td").nth(3)).toHaveText("3");
    await expect(l.locator("td").nth(4)).toHaveText(/R\$\s?6\.512,50/);
    await l.locator('button[data-forn-acao="historico"]').click();
    await expect(page.locator("#fh-body tr")).toHaveCount(3);
    await expect(page.locator("#fh-body tr").first()).toContainText("L-2027X");
    await expect(page.locator("#fh-body tr").first()).toContainText(/R\$\s?100,00/);
  });

  test("fornecedor sem entregas mostra histórico vazio", async ({ page }) => {
    await novoFornecedor(page, { nome: "Ferragens Sul", cnpj: "11444777000161" });
    await linhaForn(page, "Ferragens Sul").locator('button[data-forn-acao="historico"]').click();
    await expect(page.locator("#fh-body")).toContainText("Nenhuma entrega registrada");
  });

  test("“+ Novo fornecedor” na entrada já seleciona o fornecedor criado", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.click("#m-novo-forn");
    await page.fill("#f-nome", "Ferragens Sul");
    await page.fill("#f-cnpj", "11444777000161");
    await page.click("#f-ok");
    await expect(page.locator("#m-fornecedor option:checked")).toHaveText("Ferragens Sul");
  });

  test("recusa custo negativo", async ({ page }) => {
    await menu(page, "movimentacoes");
    await page.selectOption("#m-produto", "EX-CHA-01");
    await page.fill("#m-lote", "L-2026A");
    await page.fill("#m-custo", "-1");
    await page.fill("#m-qtd", "1");
    await page.click("#form-mov-page button[type=submit]");
    await expect(page.locator("#m-erro")).toContainText("custo unitário");
  });

  test("cadastro de produto registra fornecedor e custo do primeiro lote", async ({ page }) => {
    await menu(page, "cadastro");
    await page.fill("#p-codigo", "Q-01");
    await page.fill("#p-descricao", "Solvente");
    await page.fill("#p-minimo", "2");
    await page.fill("#p-lote", "S-1");
    await page.fill("#p-validade", "2027-09-09");
    await page.fill("#p-quantidade", "10");
    await page.selectOption("#p-fornecedor", { label: "Química Central S.A." });
    await page.fill("#p-custo", "12.5");
    await page.click("#p-ok");
    await menu(page, "fornecedores");
    await linhaForn(page, "Química Central").locator('button[data-forn-acao="historico"]').click();
    const entrega = page.locator("#fh-body tr", { hasText: "Q-01" });
    await expect(entrega).toContainText("S-1");
    await expect(entrega.locator("td").last()).toHaveText(/R\$\s?125,00/);
  });
});

test.describe("Relatórios com filtros", () => {
  // Em 23/10/2026, "últimos 6 meses" = 180 dias: de 27/04/2026 a 23/10/2026
  const kpiRel = (page, nome) => page.locator("#rep-kpis .kpi", { hasText: nome }).locator("strong");
  const linhaRel = (page, cod) => page.locator("#r-tbody tr", { hasText: cod });

  test("abre nos últimos 6 meses com todos os produtos", async ({ page }) => {
    await menu(page, "relatorios");
    await expect(page.locator("#r-resumo")).toContainText("27/04/2026 a 23/10/2026 (180 dias)");
    await expect(page.locator("#r-tbody tr")).toHaveCount(3);
    // Ordenado por consumo: chapa (35), lubrificante (21,5), resina (18)
    await expect(page.locator("#r-tbody tr").first()).toContainText("EX-CHA-01");
    await expect(linhaRel(page, "EX-LUB-02").locator("td").nth(2)).toHaveText("21,5");
    await expect(page.locator("#r-graf-sub")).toContainText("Escolha um produto");
  });

  test("filtro por produto mostra consumo médio mensal e cobertura", async ({ page }) => {
    await menu(page, "relatorios");
    await page.selectOption("#r-produto", "EX-LUB-02");
    await expect(kpiRel(page, "Consumo no período")).toHaveText("21,5");
    // 21,5 em 180 dias = 21,5 ÷ (180 ÷ 30,4375) = 3,64 por mês
    await expect(kpiRel(page, "Consumo médio mensal")).toHaveText("3,64");
    await expect(kpiRel(page, "Disponível agora")).toHaveText("8,5");
    // 8,5 ÷ (21,5 ÷ 180 por dia) = 71 dias
    await expect(kpiRel(page, "Cobertura estimada")).toHaveText("71 dias");
    await expect(kpiRel(page, "Valor comprado")).toHaveText(/R\$\s?987,00/);
    await expect(page.locator("#r-tbody tr")).toHaveCount(1);
  });

  test("gráfico tem uma coluna por mês e mostra o valor ao passar o mouse", async ({ page }) => {
    await menu(page, "relatorios");
    await page.selectOption("#r-produto", "EX-CHA-01");
    // abr/26 a out/26 = 7 meses
    await expect(page.locator("#r-grafico .alvo")).toHaveCount(7);
    await expect(page.locator("#r-grafico .media")).toHaveCount(1);
    await page.locator("#r-grafico .alvo").nth(2).hover();       // jun/26: saída de 10 (115 dias atrás = 30/06)
    await expect(page.locator("#r-tooltip")).toBeVisible();
    await expect(page.locator("#r-tooltip strong")).toHaveText("10");
    await expect(page.locator("#r-tooltip")).toContainText("jun/26");
    await page.locator("#r-grafico .alvo").nth(3).hover();       // jul/26: sem consumo
    await expect(page.locator("#r-tooltip strong")).toHaveText("0");
  });

  test("período de 30 dias considera só as movimentações recentes", async ({ page }) => {
    await menu(page, "relatorios");
    await page.selectOption("#r-periodo", "30");
    await page.selectOption("#r-produto", "EX-LUB-02");
    await expect(kpiRel(page, "Consumo no período")).toHaveText("3");
    await expect(kpiRel(page, "Consumo médio mensal")).toHaveText("3,04");
  });

  test("período personalizado e aviso de datas invertidas", async ({ page }) => {
    await menu(page, "relatorios");
    await page.fill("#r-de", "2026-05-01");
    await page.fill("#r-ate", "2026-05-31");
    await expect(page.locator("#r-periodo")).toHaveValue("custom");
    await expect(page.locator("#r-resumo")).toContainText("01/05/2026 a 31/05/2026 (31 dias)");
    await page.fill("#r-de", "2026-06-10");
    await expect(page.locator("#r-erro")).toContainText("data inicial é depois da data final");
  });

  test("uma nova saída entra no relatório", async ({ page }) => {
    await movimentar(page, { cod: "EX-CHA-01", tipo: "saida", qtd: 5 });
    await menu(page, "relatorios");
    await page.selectOption("#r-produto", "EX-CHA-01");
    await expect(kpiRel(page, "Consumo no período")).toHaveText("40");
  });
});

test.describe("Abas Consulta e Cadastro separadas", () => {
  test("a Consulta só tem busca, sem botões de cadastro", async ({ page }) => {
    await menu(page, "consulta");
    await expect(page.locator("#view-consulta #form-prod")).toHaveCount(0);
    await expect(page.locator("#consulta-contagem")).toHaveText("3 de 3 produtos");
    await page.fill("#busca", "L-120C");          // busca também por lote
    await expect(page.locator("#tbody tr")).toHaveCount(1);
    await expect(page.locator("#consulta-contagem")).toHaveText("1 de 3 produtos");
  });

  test("o Cadastro oferece digitar ou ler o código", async ({ page }) => {
    await menu(page, "cadastro");
    await expect(page.locator("#cad-modo-digitar")).toBeChecked();
    await expect(page.locator("#p-scan-btns")).toBeHidden();
    await page.check("#cad-modo-ler");
    await expect(page.locator("#p-scan-btns")).toBeVisible();
    await page.check("#cad-modo-digitar");
    await expect(page.locator("#p-scan-btns")).toBeHidden();
    await expect(page.locator("#leitor-prod")).toBeHidden();
  });

  test("depois de cadastrar, o formulário fica limpo para o próximo", async ({ page }) => {
    await novoProduto(page, { codigo: "P-200", descricao: "Fita isolante", minimo: 5, lote: "F-1", validade: "2028-02-02", quantidade: 30 });
    await expect(page.locator("#view-cadastro")).toBeVisible();
    await expect(page.locator("#cad-sucesso")).toBeVisible();
    await expect(page.locator("#p-codigo")).toHaveValue("");
    await expect(page.locator("#p-descricao")).toHaveValue("");
  });

  test("Editar na Consulta abre o Cadastro em modo edição e volta ao salvar", async ({ page }) => {
    await menu(page, "consulta");
    await page.click('#tbody button[data-acao="editar"][data-cod="EX-LUB-02"]');
    await expect(page.locator("#view-cadastro")).toBeVisible();
    await expect(page.locator("#p-titulo")).toHaveText("Editar produto EX-LUB-02");
    await expect(page.locator("#cad-opcoes")).toBeHidden();
    await expect(page.locator("#p-codigo")).toBeDisabled();
    await page.fill("#p-descricao", "Lubrificante sintético");
    await page.click("#p-ok");
    await expect(page.locator("#view-consulta")).toBeVisible();
    await expect(page.locator("#tbody tr", { hasText: "EX-LUB-02" })).toContainText("Lubrificante sintético");
  });

  test("Cancelar edição volta à Consulta sem alterar", async ({ page }) => {
    await menu(page, "consulta");
    await page.click('#tbody button[data-acao="editar"][data-cod="EX-LUB-02"]');
    await page.fill("#p-descricao", "Não deve salvar");
    await page.click("#p-cancelar");
    await expect(page.locator("#view-consulta")).toBeVisible();
    await expect(page.locator("#tbody tr", { hasText: "EX-LUB-02" })).toContainText("Lubrificante industrial");
  });

  test("abrir o Cadastro pelo menu depois de uma edição mostra um cadastro novo", async ({ page }) => {
    await menu(page, "consulta");
    await page.click('#tbody button[data-acao="editar"][data-cod="EX-LUB-02"]');
    await menu(page, "dashboard");
    await menu(page, "cadastro");
    await expect(page.locator("#p-titulo")).toHaveText("Novo produto");
    await expect(page.locator("#p-codigo")).toBeEnabled();
    await expect(page.locator("#cad-opcoes")).toBeVisible();
  });
});

test.describe("Correções", () => {
  test("editar produto permite corrigir o custo de uma entrada", async ({ page }) => {
    await menu(page, "consulta");
    await page.click('#tbody button[data-acao="editar"][data-cod="EX-LUB-02"]');
    const custo = page.locator("#p-lotes-info .custo-edit");
    await expect(custo).toHaveCount(1);                 // lubrificante tem 1 entrada no exemplo
    await expect(custo).toHaveValue("32.9");
    await custo.fill("29.9");
    await page.click("#p-ok");
    await expect(page.locator("#view-consulta")).toBeVisible();
    // Histórico de movimentações mostra o novo custo marcado como corrigido
    await menu(page, "movimentacoes");
    const linhaEntrada = page.locator("#hbody tr", { hasText: "EX-LUB-02" }).filter({ hasText: "Entrada" });
    await expect(linhaEntrada).toContainText(/R\$\s?29,90/);
    await expect(linhaEntrada).toContainText("corrigido");
    // Relatório usa o custo corrigido: 30 × R$ 29,90 = R$ 897,00
    await menu(page, "relatorios");
    await page.selectOption("#r-produto", "EX-LUB-02");
    await expect(page.locator("#rep-kpis .kpi", { hasText: "Valor comprado" }).locator("strong")).toHaveText(/R\$\s?897,00/);
  });

  test("recusa custo corrigido negativo", async ({ page }) => {
    await menu(page, "consulta");
    await page.click('#tbody button[data-acao="editar"][data-cod="EX-LUB-02"]');
    await page.locator("#p-lotes-info .custo-edit").fill("-5");
    await page.click("#p-ok");
    await expect(page.locator("#p-erro")).toContainText("custo unitário");
    await expect(page.locator("#view-cadastro")).toBeVisible();
  });

  test("rótulo do lote na movimentação é “Lote do produto”", async ({ page }) => {
    await menu(page, "movimentacoes");
    await expect(page.locator("#m-campos-entrada")).toContainText("Lote do produto");
    await expect(page.locator("#m-campos-entrada")).not.toContainText("fabricante");
  });

  for (const largura of [1280, 1100, 900, 390]) {
    test(`valor comprado cabe no cartão (tela de ${largura}px)`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await menu(page, "relatorios");
      await page.selectOption("#r-periodo", "tudo");
      for (const cartao of await page.locator("#rep-kpis .kpi").all()) {
        const cabe = await cartao.evaluate(k => { const v = k.querySelector("strong"); return v.scrollWidth <= k.clientWidth - 16 && v.getBoundingClientRect().right <= k.getBoundingClientRect().right; });
        expect(cabe).toBe(true);
      }
    });
  }
});
