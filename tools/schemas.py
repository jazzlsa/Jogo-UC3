"""Formato formal de um caso clínico do Jogo UC3.

Espelha exatamente a estrutura do objeto `CASO` que existia no protótipo
original (game/index.html) e que hoje vive em app/src/cases/*.json — esses
modelos são o "contrato" usado tanto para validar o que o Gemini gera em
generate_case.py quanto como referência de formato pra quem for editar um
caso à mão.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

# Lista fechada de áreas médicas — usada pro filtro "por área" na tela de
# seleção de caso (ver app/src/engine.js). Lista fechada em vez de texto
# livre pra garantir que o filtro sempre bata exatamente com os valores
# reais dos casos.
AreaMedica = Literal[
    "Cardiologia",
    "Pneumologia",
    "Gastroenterologia",
    "Neurologia",
    "Endocrinologia",
    "Imunologia",
    "Nefrologia/Urologia",
    "Infectologia",
    "Oncologia",
    "Ortopedia",
    "Cirurgia geral",
    "Patologia geral",
    "Ginecologia/Obstetrícia",
    "Psiquiatria",
    "Outra",
]


class Paciente(BaseModel):
    idade: int = Field(description="Idade do paciente em anos.")
    sexo: Literal["M", "F"]


class SinalVital(BaseModel):
    l: str = Field(description="Sigla do sinal vital (ex.: PA, FC, Tax, FR, SpO₂).")
    v: str = Field(description="Valor medido, como string (ex.: '124/78', '98').")
    u: str = Field(description="Unidade (ex.: mmHg, bpm, °C, irpm, %).")
    flag: bool = Field(description="True se o valor está fora da faixa normal.")


class BurnsFalas(BaseModel):
    """As falas do personagem-guia (professor Burns) — três amarradas a um
    momento fixo do jogo (ver engine.js:burnsFor()), mais as dicas, que o
    jogador libera sob demanda clicando em "Pedir dica"."""

    abertura: str = Field(description="Fala mostrada na etapa de apresentação do caso.")
    piBaixo: str = Field(description="Fala mostrada se o jogador chegar aos exames com PI <= 20.")
    fechamento: str = Field(description="Fala mostrada na tela de resultado final.")
    dicas: List[str] = Field(
        default_factory=list,
        description=(
            "Exatamente 3 dicas do Burns, cada uma mais específica que a "
            "anterior mas NENHUMA delas apontando o diagnóstico sozinha: a "
            "1ª só indica onde reler no caso; a 2ª nomeia um sistema/"
            "mecanismo fisiológico, não o órgão específico; a 3ª pode ir mais "
            "fundo, mas ainda como pergunta pro jogador responder, nunca a "
            "resposta pronta nem um achado patognomônico eponímico "
            "(ex.: 'ponto de McBurney', 'intervalo lúcido') que já equivale "
            "ao diagnóstico. Disponíveis nas etapas de anamnese em diante — "
            "o jogador libera uma de cada vez, clicando em 'Pedir dica ao "
            "Burns'."
        ),
    )


class ItemInvestigativo(BaseModel):
    """Uma pergunta de anamnese, manobra de exame físico ou exame complementar
    pedível — todos têm o mesmo formato: custam PI, podem ou não ser
    relevantes pro diagnóstico, e revelam uma resposta quando escolhidos."""

    texto: str = Field(description="O que é perguntado/examinado/pedido, como aparece no botão.")
    custo: int = Field(description="Quanto de PI (pontos de investigação) essa escolha consome.")
    relevante: bool = Field(description="True se essa informação realmente ajuda a fechar o diagnóstico correto.")
    resposta: str = Field(description="O que é revelado ao jogador ao escolher esse item.")


class Hipotese(BaseModel):
    texto: str = Field(description="Nome da hipótese diagnóstica.")
    correta: bool = Field(description="True apenas para o diagnóstico correto do caso (deve haver exatamente um).")


class Conduta(BaseModel):
    texto: str = Field(description="Descrição da conduta/tratamento proposto.")
    correta: bool = Field(description="True apenas para a conduta correta do caso (deve haver exatamente uma).")


class CasoClinico(BaseModel):
    id: str = Field(description="Identificador único em kebab-case, ex.: 'uc3-colecistite-aguda-001'.")
    tema: str = Field(
        description=(
            "Categoria clínica GERAL do caso, usada na tela de seleção — "
            "ex.: 'Abdome agudo inflamatório', 'Emergência endócrina', "
            "'Febre em paciente com cirurgia prévia'. NUNCA o nome do "
            "diagnóstico específico (isso apareceria na tela de seleção "
            "ANTES do jogador jogar e estragaria o caso — o diagnóstico só "
            "pode ser revelado dentro de `hipoteses`/`explicacao`)."
        )
    )
    materia_relacionada: str = Field(
        description=(
            "1-2 frases conectando o caso ao conteúdo da aula da UC3 que o "
            "originou (ex.: 'Este caso aplica o conceito de órgãos linfoides "
            "secundários — visto na aula sobre organização do sistema "
            "imune — mostrando o que acontece clinicamente quando o baço, "
            "um deles, é perdido.'). Mostrado na tela de resultado, depois "
            "de `explicacao`, pra deixar claro o que estudar."
        )
    )
    area: AreaMedica = Field(
        description=(
            "UMA área médica principal do caso, de uma lista fechada — usada "
            "pro jogador filtrar casos por área na tela de seleção. Escolha a "
            "área mais representativa do diagnóstico correto, mesmo que o "
            "caso toque outras de leve."
        )
    )
    prova: Optional[str] = Field(
        default=None,
        description="Prova da UC3 associada ao tema de origem (ex.: 'P1', 'P2', 'Todas'), quando conhecida.",
    )
    dificuldade: Literal["facil", "medio", "dificil"]
    pi_inicial: int = Field(description="Orçamento inicial de pontos de investigação (tipicamente 100).")
    paciente: Paciente
    queixa_principal: str = Field(description="Fala do paciente ao chegar, em primeira pessoa, com aspas.")
    sinais_vitais: List[SinalVital]
    burns: BurnsFalas
    anamnese: List[ItemInvestigativo] = Field(description="Perguntas dirigidas de anamnese (tipicamente 4-6, mistura de relevantes e distratoras).")
    exameFisico: List[ItemInvestigativo] = Field(description="Manobras/achados de exame físico (tipicamente 4-6).")
    hipoteses: List[Hipotese] = Field(description="De 4 a 6 hipóteses diagnósticas plausíveis, exatamente uma correta.")
    exames: List[ItemInvestigativo] = Field(description="Exames complementares pedíveis (tipicamente 3-5, custo maior que anamnese/exame físico).")
    condutas: List[Conduta] = Field(description="De 2 a 4 condutas possíveis, exatamente uma correta.")
    explicacao: str = Field(description="Explicação fisiopatológica final, ligando achados ao diagnóstico — mostrada na tela de resultado.")


class MaterialTema(BaseModel):
    """Formato de um arquivo em data/uc3_resumos/ — saída de extract_material.py
    e entrada (contexto/grounding) de generate_case.py."""

    tema: str
    link: str
    autor: Optional[str] = None
    prova: Optional[str] = None
    resumo: Optional[str] = None
    descricao: Optional[str] = None
    fontes: List[dict] = Field(default_factory=list, description="Uma entrada por fonte: {titulo, texto, guia}.")
