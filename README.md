# Estoque Industrial SENAI

Sistema web de controle de estoque industrial, criado a partir da versão em Python para terminal (`legado/estoque_terminal.py`).

**Acesse:** https://senaitecds-lab.github.io/estoque-senai/

## Funções

- **Dashboard:** indicadores (produtos, quantidade total, estoque baixo, próximos do vencimento, vencidos) e lista de itens que precisam de atenção.
- **Produtos:** cadastro, edição, busca e filtro. A quantidade pode ser informada em unidades ou em caixas (número de caixas × unidades por caixa).
- **Cadastro por código:** o código do produto pode ser lido de um código de barras ou QR code, pela câmera ou por uma foto.
- **Movimentações:** entradas e saídas, escolhendo o produto na lista ou lendo o código com a câmera. Inclui o histórico completo.
- **Alertas, Relatórios e Configurações:** alertas de validade e estoque mínimo, totais, reposição necessária e prazo do aviso de vencimento.

## Regras de negócio

| Regra | Comportamento |
|---|---|
| RN-01 | Produto vencido não pode ter saída |
| RN-03 | Alerta quando a quantidade fica igual ou abaixo do estoque mínimo |
| RN-04 | Saída maior que o saldo é recusada |
| RN-05 / RN-07 | Código, descrição, lote e validade são obrigatórios; o código é único; quantidades não podem ser negativas |
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
