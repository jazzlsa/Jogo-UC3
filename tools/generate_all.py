"""CLI: gera vários casos clínicos em lote, cobrindo os temas extraídos em
data/uc3_resumos/ — para cada tema, gera 3 casos (fácil/médio/difícil), cada
um com uma apresentação clínica diferente (o Gemini recebe os casos já
gerados daquele mesmo tema e é instruído a não repetir a mesma vinheta).

Uso:
    python generate_all.py                 # todos os temas extraídos
    python generate_all.py --prova P1       # só os temas daquela prova

Mais lento e mais caro (em cota de API) que generate_case.py — 3 chamadas ao
Gemini por tema. Continua pro próximo tema/dificuldade mesmo se uma chamada
falhar, reportando um resumo no final em vez de travar o lote inteiro por
causa de um erro isolado.

Só roda localmente — nunca é chamado pelo jogo empacotado (app/, mobile/).
"""

import argparse
import json
import os
import sys
import unicodedata
from typing import Optional

from dotenv import load_dotenv
from google import genai

from generate_case import CASES_DIR, REPO_ROOT, carregar_materiais, gerar_e_salvar_caso, slugify

DIFICULDADES = ["facil", "medio", "dificil"]

# Quantos casos gerar por tema, escalado pela quantidade real de material
# disponível (mais fontes/texto = tema mais rico = aguenta mais casos
# distintos) em vez de um número fixo igual pra todo tema. Ajuste estas
# constantes se quiser um lote maior/menor no geral.
MIN_CASOS_POR_TEMA = 2
MAX_CASOS_POR_TEMA = 6
CHARS_POR_CASO_EXTRA = 5000  # a cada N caracteres de fonte, ~1 caso a mais


def calcular_quantidade_casos(material: dict) -> int:
    """Heurística: conta fontes com texto + volume total de texto do tema e
    escala pra um número de casos entre MIN_CASOS_POR_TEMA e
    MAX_CASOS_POR_TEMA. Ex.: um tema com 1 fonte curta fica no mínimo (2);
    um tema com várias fontes longas (ex.: patologia celular, com várias
    transcrições) chega perto do máximo (6)."""
    fontes = material.get("fontes", []) or []
    n_fontes = sum(1 for f in fontes if f.get("texto"))
    total_chars = sum(len(f["texto"]) for f in fontes if f.get("texto"))
    score = n_fontes + total_chars / CHARS_POR_CASO_EXTRA
    return max(MIN_CASOS_POR_TEMA, min(MAX_CASOS_POR_TEMA, round(score)))


def diagnostico_correto(caso) -> str:
    h = next((h for h in caso.hipoteses if h.correta), None)
    return h.texto if h else "?"


def diagnostico_correto_dict(caso_dict: dict) -> str:
    h = next((h for h in caso_dict.get("hipoteses", []) if h.get("correta")), None)
    return h["texto"] if h else "?"


def caso_ja_existe(slug_hint: str, dificuldade: str) -> Optional[dict]:
    """Se o arquivo desse (tema, índice, dificuldade) já foi gerado numa
    rodada anterior do lote (interrompida por timeout, por ex.), devolve o
    conteúdo salvo — pra pular a chamada ao Gemini e ainda assim contar esse
    caso em `casos_existentes` (mantendo a diversidade entre dificuldades)."""
    arquivo = CASES_DIR / f"{slug_hint}-{dificuldade}.json"
    if not arquivo.exists():
        return None
    with open(arquivo, "r", encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    # Sem isso, o Python bufferiza a saída em bloco quando stdout não é um
    # terminal (ex.: redirecionado pra arquivo, como acontece rodando em
    # background) — os prints de progresso só apareceriam todos de uma vez
    # no final, em vez de em tempo real.
    sys.stdout.reconfigure(line_buffering=True)

    parser = argparse.ArgumentParser(description="Gera casos (fácil/médio/difícil, escalado por tema) em lote.")
    parser.add_argument(
        "--prova", default=None,
        help="Só gera casos pros temas dessa prova (ex.: 'P1'). Sem isso, cobre todos os temas extraídos.",
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
    quantidades = [calcular_quantidade_casos(m) for m in materiais]
    total_casos = sum(quantidades)
    print(
        f"{len(materiais)} tema(s) de material encontrados{filtro}. "
        f"Gerando {total_casos} caso(s) no total ({MIN_CASOS_POR_TEMA}-{MAX_CASOS_POR_TEMA} por tema, "
        f"escalado pela quantidade de material de cada um).\n"
    )

    ok, falhas = 0, []
    for i, (material, n_casos) in enumerate(zip(materiais, quantidades), start=1):
        tema_planilha = material.get("tema", f"tema-{i}")
        base_slug = f"uc3-{slugify(tema_planilha)}"
        print(f"[{i}/{len(materiais)}] {tema_planilha} — {n_casos} caso(s)")

        casos_existentes = []
        for j in range(n_casos):
            dificuldade = DIFICULDADES[j % len(DIFICULDADES)]
            slug_hint = f"{base_slug}-{j + 1:02d}"

            existente = caso_ja_existe(slug_hint, dificuldade)
            if existente is not None:
                casos_existentes.append({
                    "tema": existente.get("tema", ""),
                    "dificuldade": dificuldade,
                    "diagnostico_correto": diagnostico_correto_dict(existente),
                })
                print(f"    [{j + 1}/{n_casos} · {dificuldade}] já existe (rodada anterior) — pulando")
                ok += 1
                continue

            try:
                caso = gerar_e_salvar_caso(
                    client,
                    dificuldade,
                    [material],
                    tema=None,
                    casos_existentes=casos_existentes,
                    slug_hint=slug_hint,
                    prova=material.get("prova"),
                )
                casos_existentes.append({
                    "tema": caso.tema,
                    "dificuldade": dificuldade,
                    "diagnostico_correto": diagnostico_correto(caso),
                })
                print(f"    [{j + 1}/{n_casos} · {dificuldade}] OK — \"{caso.tema}\" (dx: {diagnostico_correto(caso)})")
                ok += 1
            except Exception as e:
                print(f"    [{j + 1}/{n_casos} · {dificuldade}] FALHOU: {e}", file=sys.stderr)
                falhas.append((tema_planilha, dificuldade, str(e)))

    print(f"\nConcluído: {ok} caso(s) gerados com sucesso, {len(falhas)} falha(s).")
    if falhas:
        print("Falhas:")
        for tema_planilha, dificuldade, erro in falhas:
            print(f"  - {tema_planilha} [{dificuldade}]: {erro}")


if __name__ == "__main__":
    main()
