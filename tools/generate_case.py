"""CLI: gera um novo caso clínico com o Gemini a partir do material da UC3.

Uso:
    python generate_case.py --tema "Colecistite aguda" --dificuldade medio
    python generate_case.py --tema "Pielonefrite" --prova P1

Lê o material já extraído em data/uc3_resumos/ (ver extract_material.py),
monta o prompt (tools/prompt_template.py) e pede ao Gemini um caso no formato
de tools/schemas.py:CasoClinico. Salva o resultado validado em
app/src/cases/<id>.json e atualiza app/src/cases/index.json.

Só roda localmente — nunca é chamado pelo jogo empacotado (app/, mobile/).
"""

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import ClientError, ServerError
from pydantic import ValidationError

from prompt_template import montar_system_instruction, montar_user_prompt
from schemas import CasoClinico

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data" / "uc3_resumos"
CASES_DIR = REPO_ROOT / "app" / "src" / "cases"
INDEX_PATH = CASES_DIR / "index.json"

# Mesmo padrão de modelo principal + fallback usado em
# med_study_automator/core/multimodal_processor.py (família Gemini 3.x), com
# duas correções encontradas na prática em 2026-08-25: "gemini-3.7-flash"
# pode ficar minutos pendurado antes de retornar 503 (então vem por último,
# não primeiro, na fila de fallback) e "gemini-2.5-flash" não existe mais
# pra contas novas (404) — tirado da lista.
PRIMARY_MODEL = "gemini-3.6-flash"
FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.7-flash"]
MAX_RETRIES_PER_MODEL = 2
BASE_BACKOFF_SECONDS = 4
# Timeout por chamada (ms) — sem isso, um modelo sobrecarregado pode ficar
# pendurado vários minutos numa única tentativa antes de sequer contar como
# falha e cair pro próximo modelo/tentativa.
REQUEST_TIMEOUT_MS = 45_000


def slugify(texto: str) -> str:
    nfkd = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"[^a-zA-Z0-9]+", "-", sem_acento).strip("-").lower()


def carregar_materiais(prova: str | None) -> list[dict]:
    """Lê data/uc3_resumos/*.json, opcionalmente filtrando pelo campo `prova`
    (classificado por extract_material.py a partir da cor da célula na
    planilha). Um tema marcado como "Todas" (cai nas 4 provas) sempre entra,
    não importa qual --prova foi pedido."""
    if not DATA_DIR.exists():
        return []
    materiais = []
    for path in sorted(DATA_DIR.glob("*.json")):
        with open(path, "r", encoding="utf-8") as f:
            item = json.load(f)
        item_prova = str(item.get("prova", "")).strip().lower()
        if prova and item_prova != prova.strip().lower() and item_prova != "todas":
            continue
        materiais.append(item)
    return materiais


def extrair_retry_delay(err: Exception) -> Optional[float]:
    """Lê o tempo de espera que a própria API sugeriu (RetryInfo.retryDelay,
    ex.: "26s") num erro 429 RESOURCE_EXHAUSTED. Respeitar isso em vez de um
    backoff fixo evita bater de novo na cota antes dela liberar."""
    details = getattr(err, "details", None)
    if not isinstance(details, dict):
        return None
    itens = details.get("error", {}).get("details", [])
    for item in itens:
        if item.get("@type", "").endswith("RetryInfo"):
            valor = item.get("retryDelay", "")
            if valor.endswith("s"):
                try:
                    return float(valor[:-1])
                except ValueError:
                    return None
    return None


def gerar_com_gemini(client: "genai.Client", system_instruction: str, user_prompt: str) -> CasoClinico:
    """Chama o Gemini pedindo o JSON do caso, com retry + fallback de modelo
    (503/erro transitório, 429 respeitando o retry-delay sugerido pela API)
    e retry se a resposta não bater com o schema."""
    modelos = [PRIMARY_MODEL, *FALLBACK_MODELS]
    ultimo_erro: Exception | None = None
    for modelo in modelos:
        for tentativa in range(1, MAX_RETRIES_PER_MODEL + 1):
            try:
                response = client.models.generate_content(
                    model=modelo,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=CasoClinico,
                        temperature=0.9,
                        http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
                    ),
                )
                if response.parsed is not None:
                    return response.parsed
                return CasoClinico.model_validate_json(response.text)
            except (ServerError, ClientError, httpx.TimeoutException, httpx.HTTPError) as err:
                ultimo_erro = err
                espera = extrair_retry_delay(err) or (BASE_BACKOFF_SECONDS * tentativa)
                print(f"[aviso] {modelo} falhou (tentativa {tentativa}/{MAX_RETRIES_PER_MODEL}): {err} — aguardando {espera:.0f}s", file=sys.stderr)
                time.sleep(espera)
            except ValidationError as err:
                ultimo_erro = err
                print(f"[aviso] resposta do {modelo} não bateu com o schema esperado (tentativa {tentativa}/{MAX_RETRIES_PER_MODEL}): {err}", file=sys.stderr)
                time.sleep(BASE_BACKOFF_SECONDS)
    raise RuntimeError(f"Gemini não conseguiu gerar um caso válido depois de tentar todos os modelos: {ultimo_erro}")


def atualizar_index(caso: CasoClinico, arquivo: str) -> None:
    """Acrescenta (ou substitui, se o id já existir) a entrada do caso em
    app/src/cases/index.json."""
    entradas = []
    if INDEX_PATH.exists():
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            entradas = json.load(f)
    entradas = [e for e in entradas if e.get("id") != caso.id]
    entradas.append({
        "id": caso.id,
        "tema": caso.tema,
        "dificuldade": caso.dificuldade,
        "area": caso.area,
        "prova": caso.prova,
        "arquivo": arquivo,
    })
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(entradas, f, ensure_ascii=False, indent=2)
        f.write("\n")


def gerar_e_salvar_caso(
    client: "genai.Client",
    dificuldade: str,
    materiais: list[dict],
    tema: Optional[str] = None,
    casos_existentes: Optional[list[dict]] = None,
    slug_hint: Optional[str] = None,
    prova: Optional[str] = None,
) -> CasoClinico:
    """Gera um caso com o Gemini e já salva em app/src/cases/ + atualiza o
    index.json — usado tanto pelo CLI single-shot (main, abaixo) quanto pelo
    gerador em lote (generate_all.py).

    `slug_hint` (opcional) é usado como base do nome do arquivo/id em vez do
    `id` que o Gemini sugerir, garantindo um nome estável e sem colisão entre
    dificuldades diferentes do mesmo tema (ex.: "uc3-tema-06").

    `prova` (opcional), quando informada, SOBRESCREVE o que o Gemini
    preencher em `caso.prova` — a classificação por cor da planilha (feita
    em extract_material.py) é mais confiável do que o modelo adivinhar.
    """
    system_instruction = montar_system_instruction()
    user_prompt = montar_user_prompt(tema, dificuldade, materiais, casos_existentes)

    caso = gerar_com_gemini(client, system_instruction, user_prompt)
    if prova:
        caso.prova = prova

    base = slugify(slug_hint) if slug_hint else (slugify(caso.id) or slugify(f"uc3-{tema or 'caso'}"))
    if not base.startswith("uc3-"):
        base = f"uc3-{base}"
    caso.id = f"{base}-{dificuldade}"
    arquivo = f"{caso.id}.json"

    CASES_DIR.mkdir(parents=True, exist_ok=True)
    with open(CASES_DIR / arquivo, "w", encoding="utf-8") as f:
        f.write(caso.model_dump_json(indent=2))
        f.write("\n")

    atualizar_index(caso, arquivo)
    return caso


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera um novo caso clínico do Jogo UC3 com o Gemini.")
    parser.add_argument("--tema", required=True, help="Tema clínico do caso (ex.: 'Colecistite aguda').")
    parser.add_argument("--dificuldade", default="medio", choices=["facil", "medio", "dificil"])
    parser.add_argument(
        "--prova", default=None,
        help="Filtra o material de data/uc3_resumos/ por essa prova (ex.: 'P1'). Sem isso, usa todo o material disponível.",
    )
    args = parser.parse_args()

    load_dotenv(REPO_ROOT / "tools" / ".env")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY não configurada — copie tools/.env.example para tools/.env e preencha.", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    materiais = carregar_materiais(args.prova)
    filtro = f" (prova={args.prova})" if args.prova else ""
    print(f"Material de referência encontrado: {len(materiais)} tema(s){filtro}")

    print(f"Gerando caso sobre '{args.tema}' ({args.dificuldade}) com o Gemini...")
    caso = gerar_e_salvar_caso(client, args.dificuldade, materiais, tema=args.tema, prova=args.prova)

    print(f"Caso salvo em {CASES_DIR / (caso.id + '.json')}")
    print("app/src/cases/index.json atualizado.")


if __name__ == "__main__":
    main()
