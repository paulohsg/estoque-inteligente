# Estoque Industrial SENAI

Sistema web de controle de estoque industrial, criado a partir da versão em Python para terminal (`legado/estoque_terminal.py`).

**Acesse:** https://paulohsg.github.io/estoque-inteligente/

## Funções

- **Dashboard:** indicadores (produtos, quantidade total, estoque baixo, próximos do vencimento, vencidos) e lista de itens que precisam de atenção.
- **Produtos:** cadastro, edição, busca e filtro. A quantidade pode ser informada em unidades ou em caixas (número de caixas × unidades por caixa).
- **Cadastro por código:** o código do produto pode ser lido de um código de barras ou QR code, pela câmera ou por uma foto.
- **Lotes:** cada produto pode ter vários lotes, cada um com sua validade e quantidade. A entrada registra o lote; se o lote já existe, a quantidade é somada a ele.
- **Movimentações:** entradas, saídas e descarte de lotes vencidos, escolhendo o produto na lista ou lendo o código com a câmera. A saída tira primeiro do lote que vence antes (PVPS) ou de um lote escolhido. Inclui o histórico completo, com o lote de cada movimentação.
- **Fornecedores:** cadastro, consulta e edição (nome, CNPJ validado, telefone, e-mail e endereço). Cada entrada registra o fornecedor e o custo unitário, e cada fornecedor tem seu histórico de fornecimento (produtos, lotes, quantidades, valores e datas).
- **Relatórios:** filtros por produto e período (30 dias, 90 dias, 6 meses, 12 meses, todo o histórico ou datas livres). Mostra consumo no período, consumo médio mensal, cobertura estimada em dias, valor comprado, gráfico de consumo mês a mês e o desempenho de cada produto. Também mostra a situação atual e a reposição necessária.
- **Alertas e Configurações:** alertas de validade e estoque mínimo e prazo do aviso de vencimento.

### Cálculos dos relatórios

- **Consumo médio mensal** = saídas no período ÷ (dias do período ÷ 30,4375).
- **Cobertura estimada** = disponível agora ÷ (saídas no período ÷ dias do período), em dias.
- **Valor comprado** = soma de quantidade × custo unitário das entradas no período.
- Descartes de lotes vencidos não contam como consumo.

## Regras de negócio

| Regra | Comportamento |
|---|---|
| RN-01 | Lote vencido não pode ter saída para uso; só pode ser descartado |
| RN-03 | Alerta quando o disponível (lotes dentro da validade) fica igual ou abaixo do estoque mínimo |
| RN-04 | Saída maior que o disponível (sem contar lotes vencidos) é recusada |
| RN-05 / RN-07 | Código, descrição, lote e validade são obrigatórios; o código é único; um lote tem uma única validade; não entra lote já vencido; quantidades não podem ser negativas |
| PVPS | Na saída automática, o lote que vence primeiro sai primeiro |
| RF11 / RN-10 | Toda movimentação fica registrada com data e hora |

Os dados ficam salvos no navegador de quem usa (`localStorage`). Cada computador ou celular tem os seus próprios dados.

## Publicação (GitHub Pages)

O site é publicado direto da branch `main`. Configuração (feita uma vez):
**Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save.**
Depois de cada envio para a `main`, o site atualiza sozinho em 1 ou 2 minutos.

## Câmera

A leitura de códigos usa a biblioteca [html5-qrcode](https://github.com/mebjas/html5-qrcode). A câmera ao vivo só funciona em páginas com HTTPS (como o GitHub Pages) ou abrindo o `index.html` direto no computador. O navegador pede permissão na primeira vez.

O código de barras ou QR code deve conter o **código do produto** cadastrado no sistema.

## Testes automáticos

Os testes abrem o sistema no navegador Chromium e usam como um usuário: cadastram produtos, registram movimentações, conferem as regras e leem códigos de barras e QR codes (inclusive com uma câmera simulada que "filma" um código de barras).

Eles rodam sozinhos no GitHub a cada envio (aba **Actions**). Para rodar no seu computador (precisa do [Node.js](https://nodejs.org)):

```bash
npm install
npx playwright install chromium
npm test
```

Para ver os testes rodando passo a passo, em uma janela: `npm run test:ui`.

## Estrutura

```
index.html                  o sistema (página única)
legado/estoque_terminal.py  versão original em Python
tests/estoque.spec.js       testes automáticos
tests/fixtures/             imagens e vídeo de códigos usados nos testes
.github/workflows/          testes automáticos
.nojekyll                   publica os arquivos como estão (sem Jekyll)
```
