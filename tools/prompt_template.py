"""Monta o prompt enviado ao Gemini em generate_case.py.

Usa o caso de exemplo (apendicite aguda) em app/src/cases/ como few-shot —
ele já é o "caso canônico" jogável no app, então lê o arquivo direto em vez
de duplicar o texto aqui (fica impossível os dois divergirem)."""

import json
import sys
from pathlib import Path
from typing import Optional

# Teto de quantos temas de material entram num único prompt. Sem isso, gerar
# um caso sem passar --prova (ou pra uma prova com muitos temas) monta um
# prompt gigante e estoura a cota de tokens/minuto do free tier numa única
# chamada (bug real encontrado em 2026-08-25: 81 temas inteiros num prompt
# só, 429 RESOURCE_EXHAUSTED em todos os modelos). generate_all.py já passa
# só 1 material por chamada, então esse teto na prática só protege o uso
# via generate_case.py (CLI de caso avulso) sem --prova.
MAX_MATERIAIS_NO_PROMPT = 8

REPO_ROOT = Path(__file__).resolve().parent.parent
EXEMPLO_PATH = REPO_ROOT / "app" / "src" / "cases" / "uc3-abdome-agudo-001.json"

SYSTEM_INSTRUCTION = """\
Você é o professor Burns, personagem-guia do Jogo Clínico UC3 — um jogo de \
raciocínio diagnóstico para estudantes de Medicina da FMUSP (UC3). Sua tarefa \
é gerar UM caso clínico completo, em português do Brasil, pronto pra ser \
jogado, no formato JSON exigido.

Regras do jogo que o caso precisa respeitar:
- O jogador começa com `pi_inicial` pontos de investigação (PI) e cada item \
de anamnese/exame físico/exames complementares que ele escolhe consome PI \
(campo `custo`), relevante ou não — o jogo pune investigação desnecessária.
- `anamnese` e `exameFisico` devem ter uma mistura de itens `relevante: true` \
(realmente ajudam a fechar o diagnóstico) e `relevante: false` (distratores \
GENUINAMENTE tentadores — de um diagnóstico diferencial real e plausível pro \
mesmo quadro, não uma pergunta óbvia de se descartar). O caso deve ser difícil \
de verdade: evite que o diagnóstico fique óbvio só de bater o olho na lista de \
opções (ex.: se um achado patognomônico clássico for testado, inclua também \
achados igualmente específicos de 2-3 diferenciais reais, não só distratores \
fracos).
- `exames` (complementares) custam mais PI que anamnese/exame físico.
- `hipoteses` precisa ter exatamente UMA entrada com `correta: true` — as \
demais são diagnósticos diferenciais plausíveis pro mesmo quadro, difíceis de \
descartar de cara. IMPORTANTE: varie em qual posição da lista a entrada \
correta aparece (não sempre a primeira) — o motor do jogo já embaralha a \
ordem de exibição, mas a posição no JSON não pode virar um padrão previsível.
- `condutas` precisa ter exatamente UMA entrada com `correta: true` — as \
erradas devem ser condutas plausíveis (não caricatas), erradas por um motivo \
específico (cedo demais, exame errado, faltou um passo). Mesma regra: varie \
a posição da conduta correta na lista, não sempre a primeira.
- `tema` é a categoria GERAL mostrada na tela de seleção de caso, ANTES do \
jogador jogar — comece com o identificador do material de origem quando ele \
vier no material de referência (ex.: "Tema 07 · Organização e Funcionamento \
do Sistema Imune") — mas NUNCA inclua o nome do diagnóstico (ex.: "Tema 21 · \
Emergência endócrina", não "Tema 21 · Tempestade tireotóxica"). Isso é uma \
regra rígida — um `tema` que entrega a resposta quebra o jogo inteiro.
- `burns.abertura`, `burns.piBaixo` e `burns.fechamento` são falas do próprio \
Burns: opinativas, direto ao ponto, tom de professor experiente (não \
formais/robóticas) — olhe o exemplo abaixo para calibrar o tom exato. \
Nenhuma dessas falas (nem `burns.dicas`) pode citar o nome do diagnóstico \
correto NEM um achado patognomônico que praticamente equivale a ele (ex.: \
citar "ponto de McBurney" já entrega apendicite; citar "intervalo lúcido" já \
entrega hematoma epidural).
- `burns.dicas`: EXATAMENTE 3 dicas, cada uma mais específica que a anterior, \
mas TODAS elas devem exigir raciocínio do jogador — nenhuma pode sozinha \
apontar pro diagnóstico:
  - dica 1 (a mais vaga possível): só indica ONDE olhar de novo no caso (ex.: \
    "releia com atenção o histórico cirúrgico dela") — nunca diz o quê \
    procurar lá.
  - dica 2: nomeia um SISTEMA ou MECANISMO fisiológico envolvido, sem apontar \
    o órgão/estrutura específica (ex.: "pensa em como o corpo se defende de \
    bactéria que cai na circulação").
  - dica 3 (a mais específica permitida): pode nomear o órgão/estrutura ou \
    citar um raciocínio fisiopatológico direto, mas ainda em forma de \
    pergunta que o jogador precisa responder sozinho — nunca a resposta \
    pronta, nunca um achado patognomônico batizado (eponímico) que já \
    equivale ao diagnóstico.
  Teste antes de escrever cada dica: "um estudante que não sabe nada sobre \
  esse caso, lendo só esta dica, adivinharia o diagnóstico?" Se a resposta \
  for sim, a dica está fácil demais — reescreva.
- `explicacao` deve conectar os achados da anamnese/exame/exames ao \
mecanismo fisiopatológico do diagnóstico correto, no nível de raciocínio \
clínico esperado de um estudante de graduação.
- `materia_relacionada`: 1-2 frases conectando explicitamente o caso ao \
conteúdo da aula/tema da UC3 que o originou — o que o jogador deveria \
revisar/estudar a partir desse caso.
- Use terminologia médica correta em português; não invente achados \
fisiologicamente inconsistentes com o diagnóstico correto escolhido.
- NUNCA use travessão ("—" ou " - " como pausa) em nenhum texto do caso \
(falas do Burns, enunciados, explicação, materia_relacionada, dicas). Prefira \
frases mais curtas, ponto final, vírgula ou dois-pontos. Isso vale pra TODOS \
os campos de texto do JSON gerado, sem exceção.
- Quando o material de referência for mais teórico/básico (ex.: imunologia, \
biologia celular, ferramentas de diagnóstico) em vez de já ser um caso \
clínico pronto, sua tarefa é CONSTRUIR um caso clínico plausível que exija \
aplicar esses conceitos pra chegar no diagnóstico — não recuse gerar o caso \
só porque o material não veio em formato de caso.
- Se receber uma lista de casos que já existem sobre o mesmo tema, o caso \
novo tem que ser uma apresentação clínica CLARAMENTE diferente (paciente, \
contexto, diagnóstico diferencial) — nunca uma reformulação do mesmo caso.

Exemplo de um caso já validado, no formato exato esperado (use como \
referência de tom, granularidade e nível de detalhe — NÃO copie o conteúdo \
clínico, gere um caso novo sobre o tema pedido):

{exemplo_json}
"""


def carregar_exemplo() -> str:
    with open(EXEMPLO_PATH, "r", encoding="utf-8") as f:
        return f.read().strip()


def montar_system_instruction() -> str:
    return SYSTEM_INSTRUCTION.format(exemplo_json=carregar_exemplo())


def montar_user_prompt(
    tema: Optional[str],
    dificuldade: str,
    materiais: list[dict],
    casos_existentes: Optional[list[dict]] = None,
) -> str:
    if tema:
        instrucao_tema = f"Gere um novo caso clínico sobre o tema: {tema}"
    else:
        instrucao_tema = (
            "Gere um novo caso clínico construído a partir do material de "
            "referência abaixo — escolha você mesmo a apresentação clínica "
            "(diagnóstico, paciente, contexto) mais adequada pra esse conteúdo."
        )

    partes = [
        instrucao_tema,
        f"Dificuldade: {dificuldade}",
        f"O campo `id` deve ser único e em kebab-case, começando com 'uc3-'.",
    ]

    if casos_existentes:
        partes.append(
            "\nCasos que JÁ EXISTEM sobre esse mesmo tema (o caso novo precisa "
            "ser uma apresentação clínica diferente destas, não repetir):"
        )
        for c in casos_existentes:
            partes.append(
                f"- \"{c.get('tema', '')}\" ({c.get('dificuldade', '')}): "
                f"paciente com {c.get('diagnostico_correto', '?')}"
            )

    if len(materiais) > MAX_MATERIAIS_NO_PROMPT:
        print(
            f"[aviso] {len(materiais)} temas de material encontrados — usando só os "
            f"{MAX_MATERIAIS_NO_PROMPT} primeiros no prompt (evita estourar cota de "
            f"tokens/minuto). Use --prova pra escopar melhor.",
            file=sys.stderr,
        )
        materiais = materiais[:MAX_MATERIAIS_NO_PROMPT]

    if materiais:
        partes.append(
            "\nMaterial de referência da UC3 sobre esse tema (use para embasar "
            "achados clínicos, fisiopatologia e terminologia — não é preciso "
            "citar as fontes no caso gerado):"
        )
        for m in materiais:
            bloco = [f"### Tema da aula: {m.get('tema', '')}"]
            if m.get("resumo"):
                bloco.append(f"Resumo: {m['resumo']}")
            if m.get("descricao"):
                bloco.append(f"Descrição: {m['descricao']}")
            for fonte in m.get("fontes", []):
                if fonte.get("guia"):
                    bloco.append(f"- Guia da fonte '{fonte.get('titulo', '')}': {fonte['guia']}")
                if fonte.get("texto"):
                    texto = fonte["texto"]
                    # Corta fontes muito longas para não estourar o contexto do prompt.
                    if len(texto) > 6000:
                        texto = texto[:6000] + "... [truncado]"
                    bloco.append(f"- Texto da fonte '{fonte.get('titulo', '')}': {texto}")
            partes.append("\n".join(bloco))
    else:
        partes.append(
            "\nNenhum material de referência específico foi encontrado para "
            "esse tema — gere o caso com base no seu próprio conhecimento "
            "médico, mantendo o mesmo nível de uma UC3 de graduação em "
            "Medicina."
        )

    partes.append(
        "\nRetorne APENAS o JSON do caso, no schema exigido — sem markdown, "
        "sem comentários, sem texto fora do JSON."
    )
    return "\n\n".join(partes)
