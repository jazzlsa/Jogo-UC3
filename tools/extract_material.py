"""CLI: extrai o material da aba "uc3" da planilha (um link do NotebookLM por
tema) e salva um JSON por tema em data/uc3_resumos/ — vira o "grounding" que
generate_case.py usa pra montar o prompt do Gemini.

Uso:
    python extract_material.py
    python extract_material.py --prova P1

Requisitos (ver tools/README.md):
- tools/.env com GOOGLE_CREDENTIALS_PATH e GOOGLE_SPREADSHEET_ID configurados
  (mesmo tipo de credencial de service account usada em med_study_automator);
- `notebooklm login` já feito nessa máquina (a sessão fica em ~/.notebooklm,
  por usuário — não por repositório, então reaproveita a de outro projeto se
  já existir).

Nunca é chamado pelo jogo empacotado (app/, mobile/) — só roda localmente.
"""

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Optional

import gspread
from dotenv import load_dotenv
from notebooklm import NotebookLMClient

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data" / "uc3_resumos"
WORKSHEET_NAME = "uc3"

TEMA_KEYWORDS = ["tema", "aula"]
LINK_KEYWORDS = ["link", "notebook"]
AUTOR_KEYWORDS = ["autor", "feito por", "feito"]

NOTEBOOK_ID_RE = re.compile(r"/notebook/([0-9a-fA-F-]{36})")

# A prova de cada tema é dada pela cor de fundo da própria célula da coluna A
# (o tema) — NÃO pelo texto das colunas "Prova"/"Cor", que só existe nas
# primeiras linhas da planilha e é uma legenda solta (explica o que cada cor
# significa), não um dado por linha. Paleta calibrada batendo cor real x
# legenda em 2026-08-25 — cinza = cai nas 4 provas, branco/sem cor = não cai
# em nenhuma prova.
COR_PALETTE = {
    "Todas": (0.4, 0.4, 0.4),
    "P1": (1.0, 1.0, 0.0),
    "P2": (0.2901961, 0.5254902, 0.9098039),
    "P3": (0.5764706, 0.76862746, 0.49019608),
    "P4": (0.8784314, 0.4, 0.4),
}
COR_DISTANCIA_MAX = 0.05  # limiar (distância euclidiana² em RGB 0-1) pra aceitar um match


def classificar_prova_por_cor(bg: Optional[dict]) -> str:
    """Mapeia a cor de fundo (dict {red,green,blue}, canais ausentes = 0) da
    célula da coluna A pra uma prova, usando COR_PALETTE. Sem cor ou branco
    puro = "nenhuma" (não cai em nenhuma prova). Cor não reconhecida =
    "indefinida" (não força um match errado)."""
    if not bg:
        return "nenhuma"
    r, g, b = bg.get("red", 0), bg.get("green", 0), bg.get("blue", 0)
    if r > 0.95 and g > 0.95 and b > 0.95:
        return "nenhuma"
    melhor, melhor_dist = None, float("inf")
    for nome, (pr, pg, pb) in COR_PALETTE.items():
        dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if dist < melhor_dist:
            melhor, melhor_dist = nome, dist
    return melhor if melhor_dist < COR_DISTANCIA_MAX else "indefinida"


def find_column(headers: list[str], keywords: list[str]) -> Optional[str]:
    """Primeiro cabeçalho que contém alguma das keywords (case-insensitive) —
    mesmo padrão usado em med_study_automator/core/sheets_sync.py, pra não
    depender do texto exato/maiúsculas da coluna na planilha."""
    return next((h for h in headers if any(k in str(h).lower() for k in keywords)), None)


def slugify(texto: str) -> str:
    nfkd = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"[^a-zA-Z0-9]+", "-", sem_acento).strip("-").lower()


def extrair_notebook_id(url: str) -> Optional[str]:
    m = NOTEBOOK_ID_RE.search(url)
    return m.group(1) if m else None


def campo(obj: Any, *nomes: str, default: Any = None) -> Any:
    """Acesso defensivo a um campo que pode vir como atributo (dataclass/
    pydantic da notebooklm-py) ou como dict, tentando cada nome em `nomes`
    em ordem — evita quebrar por causa de uma diferença de versão da lib."""
    if obj is None:
        return default
    for nome in nomes:
        if isinstance(obj, dict) and nome in obj:
            return obj[nome]
        if hasattr(obj, nome):
            return getattr(obj, nome)
    return default


def ler_linhas_planilha(prova_filtro: Optional[str]) -> list[dict]:
    # Caminho relativo em GOOGLE_CREDENTIALS_PATH é resolvido a partir da raiz
    # do repo, não do diretório de onde o script é chamado — assim funciona
    # igual rodando de tools/ (`python extract_material.py`) ou da raiz
    # (`python tools/extract_material.py`).
    credentials_path = Path(os.environ["GOOGLE_CREDENTIALS_PATH"])
    if not credentials_path.is_absolute():
        credentials_path = REPO_ROOT / credentials_path
    spreadsheet_id = os.environ["GOOGLE_SPREADSHEET_ID"]

    gc = gspread.service_account(filename=str(credentials_path))
    planilha = gc.open_by_key(spreadsheet_id)
    # Busca a aba por nome ignorando maiúsculas/minúsculas (a planilha real
    # tem "UC3", "UC1" etc. — .worksheet() do gspread é case-sensitive).
    aba = next(
        (ws for ws in planilha.worksheets() if ws.title.strip().lower() == WORKSHEET_NAME.lower()),
        None,
    )
    if aba is None:
        nomes = [ws.title for ws in planilha.worksheets()]
        raise RuntimeError(f"Não encontrei a aba '{WORKSHEET_NAME}' na planilha. Abas disponíveis: {nomes}")

    headers = aba.row_values(1)
    # A coluna de tema pode não ter cabeçalho (célula A1 vazia, achado real
    # nesta planilha) — nesse caso cai pra primeira coluna, mesma convenção
    # usada em med_study_automator/core/sheets_sync.py.
    tema_encontrada = find_column(headers, TEMA_KEYWORDS)
    col_tema = tema_encontrada if tema_encontrada is not None else (headers[0] if headers else None)
    col_link = find_column(headers, LINK_KEYWORDS)
    col_autor = find_column(headers, AUTOR_KEYWORDS)
    if col_tema is None or col_link is None:
        raise RuntimeError(
            f"Não encontrei as colunas de tema/link no cabeçalho da aba '{WORKSHEET_NAME}': {headers}"
        )

    registros = aba.get_all_records()

    # Cor de fundo da coluna A (tema) de cada linha de dado — é essa cor que
    # define a prova (ver COR_PALETTE acima), não o texto das colunas
    # "Prova"/"Cor" (que é só uma legenda solta nas primeiras linhas).
    n = len(registros)
    meta = aba.spreadsheet.fetch_sheet_metadata(params={
        "ranges": [f"{aba.title}!A2:A{n + 1}"],
        "fields": "sheets.data.rowData.values.userEnteredFormat.backgroundColor",
        "includeGridData": "true",
    })
    linhas_cor = meta["sheets"][0]["data"][0].get("rowData", [])

    linhas = []
    for i, r in enumerate(registros):
        link = str(r.get(col_link, "")).strip()
        tema = str(r.get(col_tema, "")).strip()
        if not link or not tema:
            continue  # ex.: aulas práticas, que não têm link de notebook

        vals = linhas_cor[i].get("values", []) if i < len(linhas_cor) else []
        bg = vals[0].get("userEnteredFormat", {}).get("backgroundColor") if vals else None
        prova = classificar_prova_por_cor(bg)

        if prova_filtro:
            filtro = prova_filtro.strip().lower()
            if prova.lower() != filtro and prova.lower() != "todas":
                continue

        linhas.append({
            "tema": tema,
            "link": link,
            "autor": str(r.get(col_autor, "")).strip() if col_autor else "",
            "prova": prova,
        })
    return linhas


async def extrair_notebook(client: "NotebookLMClient", linha: dict) -> Optional[dict]:
    notebook_id = extrair_notebook_id(linha["link"])
    if not notebook_id:
        print(f"[pulado] link sem notebook_id reconhecível ({linha['tema']}): {linha['link']}", file=sys.stderr)
        return None

    try:
        resumo = await client.notebooks.get_summary(notebook_id)
    except Exception as e:
        print(f"[aviso] get_summary falhou pra '{linha['tema']}' ({notebook_id}): {e}", file=sys.stderr)
        resumo = None

    try:
        descricao_obj = await client.notebooks.get_description(notebook_id)
        descricao = campo(descricao_obj, "description", "summary", "text", default=str(descricao_obj))
    except Exception as e:
        print(f"[aviso] get_description falhou pra '{linha['tema']}' ({notebook_id}): {e}", file=sys.stderr)
        descricao = None

    try:
        sources = await client.sources.list(notebook_id)
    except Exception as e:
        # Notebook inacessível/deletado etc. — pula o tema inteiro, não
        # derruba o resto da extração.
        print(f"[erro] não consegui listar fontes de '{linha['tema']}' ({notebook_id}), pulando: {e}", file=sys.stderr)
        return None

    fontes = []
    for fonte in sources:
        fonte_id = campo(fonte, "id", "source_id")
        titulo = campo(fonte, "title", "name", default="")
        if not fonte_id:
            continue
        try:
            fulltext = await client.sources.get_fulltext(notebook_id, fonte_id)
            texto = campo(fulltext, "content", "text")
        except Exception as e:
            print(f"[aviso] get_fulltext falhou pra fonte '{titulo}' de '{linha['tema']}': {e}", file=sys.stderr)
            texto = None
        try:
            guia = await client.sources.get_guide(notebook_id, fonte_id)
            guia_texto = campo(guia, "summary", "text")
        except Exception as e:
            print(f"[aviso] get_guide falhou pra fonte '{titulo}' de '{linha['tema']}': {e}", file=sys.stderr)
            guia_texto = None
        fontes.append({"titulo": titulo, "texto": texto, "guia": guia_texto})

    return {
        "tema": linha["tema"],
        "link": linha["link"],
        "autor": linha["autor"],
        "prova": linha["prova"],
        "resumo": resumo,
        "descricao": descricao,
        "fontes": fontes,
    }


async def main_async(prova_filtro: Optional[str]) -> None:
    linhas = ler_linhas_planilha(prova_filtro)
    filtro_txt = f" com prova='{prova_filtro}'" if prova_filtro else ""
    print(f"{len(linhas)} linha(s) da aba '{WORKSHEET_NAME}'{filtro_txt} encontradas.")
    if not linhas:
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    ok, falhas = 0, 0
    async with NotebookLMClient.from_storage() as client:
        for i, linha in enumerate(linhas, start=1):
            print(f"[{i}/{len(linhas)}] {linha['tema']}...")
            resultado = await extrair_notebook(client, linha)
            if resultado is None:
                falhas += 1
                continue
            slug = slugify(linha["tema"]) or f"tema-{i:02d}"
            destino = DATA_DIR / f"{slug}.json"
            with open(destino, "w", encoding="utf-8") as f:
                json.dump(resultado, f, ensure_ascii=False, indent=2)
                f.write("\n")
            ok += 1

    print(f"Concluído: {ok} tema(s) salvos em {DATA_DIR}, {falhas} pulado(s) por erro.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrai o material da UC3 (planilha + NotebookLM) para data/uc3_resumos/.")
    parser.add_argument("--prova", default=None, help="Processa só as linhas cuja coluna 'prova' bate com esse valor (ex.: 'P1').")
    args = parser.parse_args()

    load_dotenv(REPO_ROOT / "tools" / ".env")
    if not os.getenv("GOOGLE_CREDENTIALS_PATH") or not os.getenv("GOOGLE_SPREADSHEET_ID"):
        print(
            "GOOGLE_CREDENTIALS_PATH / GOOGLE_SPREADSHEET_ID não configurados — "
            "copie tools/.env.example para tools/.env e preencha.",
            file=sys.stderr,
        )
        sys.exit(1)

    asyncio.run(main_async(args.prova))


if __name__ == "__main__":
    main()
