# Grand Round UC3

Jogo de raciocínio diagnóstico para Medicina (baseado na UC3, FMUSP, mas
aberto pra qualquer estudante/profissional da área). O jogador percorre 6
etapas de um caso clínico — anamnese, exame físico, hipóteses diagnósticas,
exames complementares, diagnóstico final e conduta — gastando nota a cada
pergunta, manobra ou exame que escolhe. Burns, o professor-guia, comenta em
momentos fixos do caso e dá dicas sob demanda. Dá pra jogar caso a caso (por
prova/tema ou por área médica) ou entrar num **Desafio** de 10 casos
sorteados, que vira uma nota final (0-10, precisa de 5 pra passar — com
direito a prova de recuperação) registrada no ranking.

🎮 **Jogue agora, no navegador, sem instalar nada:**
[jazzlsa.github.io/Jogo-UC3](https://jazzlsa.github.io/Jogo-UC3/) — versão em
desenvolvimento contínuo, atualiza a cada push na `main`.

## Estrutura do repo

- [`app/`](app/) — o jogo em si (HTML/CSS/JS puro) + o empacotamento desktop
  via Electron (Windows/Mac). **100% offline**, sem nenhuma chave de API.
- [`mobile/`](mobile/) — o mesmo jogo empacotado como app Android (`.apk`)
  via Capacitor, sem loja e sem custo.
- [`tools/`](tools/) — scripts em Python que geram casos novos com o Gemini a
  partir do material da UC3 (planilha + NotebookLM). Roda só localmente, na
  máquina de quem está criando conteúdo — nunca entra no jogo empacotado.
- `.github/workflows/build-release.yml` — builda os três instaladores e
  publica numa GitHub Release.
- `.github/workflows/pages.yml` — publica `app/src/` no GitHub Pages a cada
  push na `main` (é o que serve o link jogável acima).

## Jogar em desenvolvimento

```
cd app
npm install
npm run start
```

Abre a tela de seleção de caso (lê `app/src/cases/index.json`) e a partir daí
é o fluxo normal do jogo.

## Gerar um caso novo com o Gemini

Ver [`tools/README.md`](tools/README.md) — resumo:

```
cd tools
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
# copiar tools/.env.example -> tools/.env e preencher
python extract_material.py --prova P1
python generate_case.py --tema "Colecistite aguda" --dificuldade medio --prova P1
```

O caso novo aparece automaticamente na tela de seleção do jogo.

## Buildar os instaladores

- **Windows/Mac (Electron)**: `cd app && npm run dist` (usa
  [electron-builder](https://www.electron.build/)) — gera `.exe` (Windows) e
  `.dmg`/`.zip` (Mac) em `app/dist/`.
- **Android (`.apk`)**: ver [`mobile/README.md`](mobile/README.md) — precisa
  gerar uma keystore de assinatura local (gratuita) uma única vez.

O jeito automático é via GitHub Actions: dar push numa tag `v*` (ou disparar
`build-release` manualmente pela aba Actions) builda os três e sobe como
assets de uma Release.

**Builds não são assinados por uma autoridade paga** (isso ficaria em torno de
uma conta de desenvolvedor Apple/Microsoft), então:
- **Windows**: o SmartScreen avisa "Windows protegeu seu PC" — clicar em
  "Mais informações" → "Executar assim mesmo".
- **Mac**: o Gatekeeper bloqueia na primeira abertura — clicar com o botão
  direito no app → "Abrir" (em vez de dar duplo clique).
- **Android**: precisa ativar "Instalar apps de fontes desconhecidas" pra
  abrir o `.apk` (ele é assinado com uma keystore própria, só não vem da Play
  Store).

## Modo pesquisa (coleta de dados do projeto de IC)

Na tela inicial, o botão **🔬 Pesquisa** permite ao participante digitar o
código de participante que recebeu ao assinar o TCLE. A partir daí, cada caso
concluído (e cada desafio/recuperação) é registrado só com esse código: tempo,
itens relevantes e distratores escolhidos em cada etapa, acertos de hipótese,
diagnóstico e conduta, dicas usadas e nota. Sem código, nada é registrado.
Nenhum nome, e-mail ou nº USP é coletado.

- Os registros ficam sempre no aparelho (dá pra baixar em `.json` na própria
  tela Pesquisa).
- Se `pesquisaApi` estiver preenchido em [`app/src/config.js`](app/src/config.js),
  eles também são enviados pro servidor da pesquisa; sem internet, ficam numa
  fila e são reenviados na próxima abertura do jogo. **Deixar vazio até a
  aprovação do CEP.**
- O servidor é o próprio Cloudflare Pages: [`app/functions/api/registro.js`](app/functions/api/registro.js)
  recebe os registros e grava num banco D1 ([`app/schema.sql`](app/schema.sql));
  [`app/functions/api/exportar.js`](app/functions/api/exportar.js) baixa tudo
  em CSV pra análise, protegido por senha (`EXPORT_TOKEN`).

### Publicar no Cloudflare Pages (jogo + servidor da pesquisa)

O GitHub Pages só serve arquivos estáticos, por isso não consegue receber os
registros. No Cloudflare Pages, o mesmo `app/src/` é publicado junto com as
Functions. Uma vez só:

```
cd app
npx wrangler login
npx wrangler d1 create uc3-pesquisa          # copiar o database_id pro wrangler.toml
npx wrangler d1 execute uc3-pesquisa --remote --file=schema.sql
npx wrangler pages project create grand-round-uc3 --production-branch main
npx wrangler pages secret put EXPORT_TOKEN    # senha pra baixar o CSV
```

A cada atualização: `cd app && npx wrangler pages deploy`. Depois de
publicado, trocar `pesquisaApi` em `config.js` por `"/api/registro"` (ou pela
URL completa `https://grand-round-uc3.pages.dev/api/registro` nos builds
desktop/Android). Pra baixar os dados:

```
curl -H "Authorization: Bearer <EXPORT_TOKEN>" https://grand-round-uc3.pages.dev/api/exportar -o registros.csv
```

## Formato de um caso

Cada caso é um `.json` em `app/src/cases/`, no formato descrito por
[`tools/schemas.py`](tools/schemas.py) (`CasoClinico`) — é o mesmo schema que
o Gemini é instruído a seguir em `tools/generate_case.py`. `app/src/cases/uc3-abdome-agudo-001.json`
(apendicite aguda) é o caso de referência/exemplo.
