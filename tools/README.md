# tools/ — geração de casos com o Gemini

Ferramentas de **autoria**, em Python. Rodam só na sua máquina, geram os
arquivos `.json` de caso que entram em `app/src/cases/`, e **nunca** entram no
jogo empacotado (`app/`, `mobile/`) — o app distribuído não faz nenhuma
chamada de rede nem carrega chave nenhuma.

## Setup (uma vez)

1. Crie um venv e instale as dependências:

   ```
   cd tools
   python -m venv venv
   venv\Scripts\activate        # Windows
   pip install -r requirements.txt
   ```

2. Copie `tools/.env.example` para `tools/.env` e preencha:
   - `GEMINI_API_KEY` — pegue em https://aistudio.google.com/apikey.
   - `GOOGLE_CREDENTIALS_PATH` — caminho pro JSON de uma service account do
     Google com acesso de leitura à planilha (mesmo tipo de credencial usada
     em `med_study_automator/config/credentials.json` — pode copiar esse
     arquivo pra `tools/config/credentials.json`, ou apontar direto pro
     caminho onde ele já está).
   - `GOOGLE_SPREADSHEET_ID` — já vem preenchido com o ID da planilha da UC3.

3. Login no NotebookLM (se ainda não tiver feito em nenhum projeto):

   ```
   notebooklm login
   ```

   Essa sessão fica salva em `~/.notebooklm` — por usuário/máquina, não por
   repositório. Se você já rodou `notebooklm login` pro `med_study_automator`,
   não precisa logar de novo aqui.

## Uso

### 1. Extrair o material da UC3

Lê a aba **"uc3"** da planilha (colunas `tema`, `link do NotebookLM`, `autor`,
`prova`), abre cada notebook do NotebookLM e salva um JSON por tema em
`data/uc3_resumos/` (resumo, descrição e o texto de cada fonte):

```
python extract_material.py
python extract_material.py --prova P1     # só os temas daquela prova
```

Notebooks inacessíveis ou deletados são pulados (com aviso no terminal), sem
travar o resto da extração.

### 2. Gerar um caso novo

```
python generate_case.py --tema "Colecistite aguda" --dificuldade medio
python generate_case.py --tema "Pielonefrite" --prova P1
```

Monta o prompt com o material relevante de `data/uc3_resumos/` (filtrado por
`--prova`, se passado) + o caso da apendicite como exemplo de formato/tom,
pede ao Gemini o JSON do caso (`response_schema` = `schemas.CasoClinico`,
mesmo padrão de retry/fallback de modelo usado no `med_study_automator`), e
salva:

- `app/src/cases/<id-do-caso>.json`
- atualiza `app/src/cases/index.json` (a tela de seleção de caso do jogo lê
  esse arquivo)

Depois é só rodar o jogo (`app/`, `npm run start`) pra jogar o caso novo.

## Arquivos

- `extract_material.py` — planilha (aba "uc3") + NotebookLM → `data/uc3_resumos/*.json`
- `generate_case.py` — `data/uc3_resumos/*.json` + Gemini → `app/src/cases/*.json`
- `schemas.py` — modelos Pydantic que definem o formato de um caso (`CasoClinico`)
- `prompt_template.py` — persona do Burns, regras do jogo e o few-shot (caso da apendicite)
