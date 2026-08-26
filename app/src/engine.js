/* ---------------- Jogo Clínico UC3 — motor ----------------
   Mesmo motor do protótipo original (game/index.html), reorganizado para:
   - carregar casos de arquivos JSON em cases/ (via fetch) em vez de um
     objeto CASO fixo no código;
   - telas de início, seleção (por prova/tema, por área, desafio) e ranking;
   - um desafio de N casos vira uma "nota final" (média 0-10, como na UC3 de
     verdade) que decide aprovação, com direito a recuperação se reprovar.
   Esse arquivo é compartilhado, sem alteração, pelos três empacotamentos do
   jogo (Electron, Android/Capacitor e navegador comum) — por isso usa só
   fetch()/localStorage/DOM padrão, nada específico de plataforma. */

const STAGES = ["intro", "anamnese", "exame", "hipoteses", "exames", "diagnostico", "conduta", "resultado"];
const RANKING_KEY = "uc3-ranking-desafios";
const DESAFIO_TAMANHO = 10;
const RECUPERACAO_TAMANHO = 5;
const RECUPERACAO_MINIMO_ACERTOS = 3;
const NOTA_MINIMA_APROVACAO = 5;
const NOTA_APROVACAO_RECUPERACAO = 5; // nota final trava nesse valor se passar na recuperação, nunca mais que isso
const NOTA_MINIMA_PARA_RECUPERACAO = 3; // abaixo disso, reprovação direta: nem tem direito a fazer a recuperação

let casesIndex = [];
let state = { screen: "home" };

// Avaliação em andamento (desafio ou recuperação) — fica FORA de `state` de
// propósito: `state` é substituído por inteiro a cada novoJogo()/voltarMenu(),
// mas a avaliação precisa sobreviver a "pausar e voltar ao menu" no meio de
// um caso.
let avaliacaoAtual = null; // { tipo: "desafio"|"recuperacao", arquivos, indice, somaTotais, acertos, salvo, notaOriginal? }

// Filtro do Desafio (por prova e/ou tema) — também fora de `state` pelo mesmo
// motivo do avaliacaoAtual: precisa sobreviver a re-renders da tela de menu.
let desafioFiltro = { prova: null, tema: null };

async function boot() {
  try {
    const res = await fetch("cases/index.json");
    casesIndex = await res.json();
  } catch (e) {
    console.error("Falha ao carregar cases/index.json", e);
    casesIndex = [];
  }
  render();
}

/* Embaralha um array in-place (Fisher-Yates). Usado pra randomizar a ordem
   de exibição de hipoteses/condutas — sem isso, a opção correta tende a
   ficar sempre na mesma posição (achado real: nos 21 casos atuais, tanto a
   hipótese quanto a conduta corretas estavam sempre no índice 0, dava pra
   "ganhar" só clicando na primeira opção sempre). Embaralhando aqui, uma
   vez por carregamento do caso, o problema fica resolvido de vez — pra
   qualquer caso, atual ou futuro, não importa a ordem em que foi escrito. */
function embaralharArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function selecionarCaso(arquivo, modoAvaliacao) {
  try {
    const res = await fetch(`cases/${arquivo}`);
    const caso = await res.json();
    embaralharArray(caso.hipoteses);
    embaralharArray(caso.condutas);
    novoJogo(caso, modoAvaliacao || null);
  } catch (e) {
    console.error(`Falha ao carregar cases/${arquivo}`, e);
  }
}

function novoJogo(caso, modoAvaliacao) {
  state = {
    screen: "game",
    caso,
    stageIdx: 0,
    pi: caso.pi_inicial,
    anamnesePicked: [],
    examePicked: [],
    hipotesesPicked: [],
    examesPicked: [],
    diagnostico: null,
    conduta: null,
    dicasReveladas: 0,
    dicaAberta: false,
    modoAvaliacao: modoAvaliacao || null, // null | "desafio" | "recuperacao"
    avaliacaoAplicada: false,
    mostrarRevisao: false,
  };
  render();
}

function voltarMenu() {
  state = { screen: "menu", menuTab: state.menuTab || "prova" };
  render();
}

function voltarHome() {
  state = { screen: "home" };
  render();
}

/* ---------------- Desafio e Recuperação ----------------
   Um desafio sorteia DESAFIO_TAMANHO casos aleatórios (sem repetir); ao
   final, a nota é a MÉDIA das notas de cada caso (0-10, igual boletim da
   UC3) — precisa >= NOTA_MINIMA_APROVACAO pra passar. Reprovou? Pode fazer
   uma recuperação: RECUPERACAO_TAMANHO casos difíceis, precisa acertar o
   diagnóstico em pelo menos RECUPERACAO_MINIMO_ACERTOS pra passar — e, se
   passar, a nota final trava em NOTA_APROVACAO_RECUPERACAO (nunca mais que
   isso), do jeito que funciona recuperação de verdade. */
function embaralhar(lista) {
  return [...lista].sort(() => Math.random() - 0.5);
}

function casesFiltrados() {
  return casesIndex.filter(c =>
    (!desafioFiltro.prova || c.prova === desafioFiltro.prova) &&
    (!desafioFiltro.tema || c.tema === desafioFiltro.tema)
  );
}

function iniciarDesafio(tamanho) {
  const pool = casesFiltrados();
  const escolhidos = embaralhar(pool).slice(0, Math.min(tamanho, pool.length));
  avaliacaoAtual = { tipo: "desafio", arquivos: escolhidos.map(c => c.arquivo), indice: 0, somaTotais: 0, acertos: 0, salvo: false };
  jogarProximaDaAvaliacao();
}

function iniciarRecuperacao(notaOriginal) {
  const dificeis = embaralhar(casesIndex.filter(c => c.dificuldade === "dificil"));
  const resto = embaralhar(casesIndex.filter(c => c.dificuldade !== "dificil"));
  const escolhidos = [...dificeis, ...resto].slice(0, Math.min(RECUPERACAO_TAMANHO, casesIndex.length));
  avaliacaoAtual = { tipo: "recuperacao", arquivos: escolhidos.map(c => c.arquivo), indice: 0, somaTotais: 0, acertos: 0, salvo: false, notaOriginal };
  jogarProximaDaAvaliacao();
}

function jogarProximaDaAvaliacao() {
  if (!avaliacaoAtual || avaliacaoAtual.indice >= avaliacaoAtual.arquivos.length) return;
  selecionarCaso(avaliacaoAtual.arquivos[avaliacaoAtual.indice], avaliacaoAtual.tipo);
}

function notaDoTotal(total) {
  return total / 22; // total do caso vai até 220 -> escala 0-10
}

function carregarRanking() {
  try {
    const raw = localStorage.getItem(RANKING_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* localStorage indisponível — ranking fica vazio */ }
  return [];
}

function salvarResultadoRanking(entrada) {
  const ranking = carregarRanking();
  ranking.push(entrada);
  ranking.sort((a, b) => b.notaFinal - a.notaFinal);
  try { localStorage.setItem(RANKING_KEY, JSON.stringify(ranking.slice(0, 50))); } catch (e) { /* best-effort */ }
}

function pedirDica() {
  const total = (state.caso.burns.dicas || []).length;
  if (state.dicasReveladas < total) state.dicasReveladas++;
  state.dicaAberta = true;
  render();
}

function fecharDica() {
  state.dicaAberta = false;
  render();
}

function gastarPI(custo) {
  state.pi = Math.max(0, state.pi - custo);
}

function stepperHTML() {
  const jogaveis = STAGES.slice(0, -1); // sem "resultado"
  return `<div class="stepper">${jogaveis.map((s, i) => {
    let cls = "seg";
    if (i < state.stageIdx) cls += " done";
    else if (i === state.stageIdx) cls += " now";
    return `<div class="${cls}"></div>`;
  }).join("")}</div>`;
}

function hudHTML(stage) {
  const notaAtual = (state.pi / state.caso.pi_inicial) * 10;
  const low = notaAtual <= 3;
  const pct = Math.max(0, Math.min(100, (state.pi / state.caso.pi_inicial) * 100));
  const faseNum = Math.min(STAGES.indexOf(stage) + 1, 6);
  return `
  <div class="hud">
    <div class="pi-meter">
      <span class="pi-name">Nota</span>
      <div class="pi-track"><div class="pi-fill ${low ? "low" : ""}" style="width:${pct}%"></div></div>
      <span class="pi-text ${low ? "low" : ""}">${notaAtual.toFixed(1)}/10</span>
    </div>
    <div class="hud-fase">Fase ${faseNum}/6</div>
  </div>`;
}

/* Burns aparece em três momentos fixos (abertura/nota baixa/fechamento) E
   sob demanda (dica) — as duas fontes competem pelo mesmo "slot" de popup;
   dica tem prioridade enquanto estiver aberta. */
function burnsFor(stage) {
  const burns = state.caso.burns;
  if (stage === "intro") return { who: "abertura", texto: burns.abertura };
  if (stage === "exames" && (state.pi / state.caso.pi_inicial) * 10 <= 3) return { who: "nota baixa", texto: burns.piBaixo };
  if (stage === "resultado") {
    const diagCorretoIdx = state.caso.hipoteses.findIndex(h => h.correta);
    const diagCerto = state.diagnostico === diagCorretoIdx;
    if (diagCerto) return { who: "fechamento", texto: burns.fechamento };
    return {
      who: "fechamento",
      texto: "Não foi dessa vez. Releia a explicação com calma, o raciocínio clínico se constrói errando e corrigindo. Bora pro próximo.",
    };
  }
  return null;
}

function burnsPopHTML(entry, fechavel) {
  if (!entry) return "";
  return `
  <div class="burns-pop">
    <div class="bubble">
      ${fechavel ? `<button class="bubble-close" data-fechar-dica aria-label="Fechar dica">×</button>` : ""}
      <p class="who">Burns · ${entry.who}</p>
      <p>“${entry.texto}”</p>
    </div>
    <img class="burns-sprite" src="assets/burns.png" alt="Burns">
  </div>`;
}

/* Botão de dica: sempre visível nas etapas investigativas. O popup em si só
   aparece quando dicaAberta=true (fechável com "×", reabre clicando de novo
   no botão — que também libera a próxima dica, se houver). */
function dicasControlHTML(stage) {
  if (stage === "intro" || stage === "resultado") return "";
  const dicas = state.caso.burns.dicas || [];
  if (dicas.length === 0) return "";
  const label = state.dicasReveladas === 0 ? "💡 Pedir dica ao Burns" : `💡 Ver dica (${state.dicasReveladas}/${dicas.length})`;
  return `<button class="hint-btn" data-dica>${label}</button>`;
}

function dicaPopupHTML(stage) {
  if (!state.dicaAberta || stage === "intro" || stage === "resultado") return null;
  const dicas = state.caso.burns.dicas || [];
  if (state.dicasReveladas === 0) return null;
  const texto = dicas.slice(0, state.dicasReveladas).map((d, i) => `Dica ${i + 1}: ${d}`).join("  •  ");
  return { who: "dica", texto };
}

function vitalsHTML() {
  return `<div class="vitals">${state.caso.sinais_vitais.map(v => `
    <div class="vital ${v.flag ? "flag" : ""}"><div class="l">${v.l}</div><div class="v">${v.v} <span style="font-size:10px;color:var(--ink-faint)">${v.u}</span></div></div>
  `).join("")}</div>`;
}

function render() {
  const app = document.getElementById("app");

  if (state.screen === "home") {
    app.innerHTML = `<div class="game-window">${renderHome()}</div>`;
    wireHome();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  if (state.screen === "ranking") {
    app.innerHTML = `
      <div class="game-window">
        <div class="window-bar">
          <span class="window-dots"><i></i><i></i><i></i></span>
          <span class="window-title">🏆 Ranking · Grand Round UC3</span>
        </div>
        <div class="scene">${renderRanking()}</div>
      </div>`;
    wireRanking();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  if (state.screen === "menu") {
    app.innerHTML = `
      <div class="game-window">
        <div class="window-bar">
          <span class="window-dots"><i></i><i></i><i></i></span>
          <span class="window-title">🩺 Grand Round UC3</span>
        </div>
        <div class="scene">
          ${renderMenu()}
        </div>
      </div>`;
    wireMenu();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  const stage = STAGES[state.stageIdx];
  const dicaPop = dicaPopupHTML(stage);
  app.innerHTML = `
    <div class="game-window">
      <div class="window-bar">
        <span class="window-dots"><i></i><i></i><i></i></span>
        <span class="window-title">🩺 Grand Round UC3 · ${state.caso.tema}</span>
      </div>
      ${hudHTML(stage)}
      <div class="scene">
        ${stage === "resultado" ? "" : stepperHTML()}
        ${renderStage(stage)}
        ${dicasControlHTML(stage)}
        ${dicaPop ? burnsPopHTML(dicaPop, true) : burnsPopHTML(burnsFor(stage), false)}
      </div>
    </div>`;
  wireStage(stage);
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ---------------- Tela inicial ---------------- */
function renderHome() {
  return `
    <div class="home-scene">
      <div class="home-icons">🩺 🧬 🫀 🧠 💊 🦴 🔬</div>
      <h1 class="home-title">GRAND ROUND<br><span>UC3</span></h1>
      <p class="home-subtitle">Raciocínio clínico e diagnóstico, pra quem estuda, já estudou, ou simplesmente ama Medicina.</p>
      <img class="home-burns" src="assets/burns.png" alt="Burns, o professor-guia">
      <div class="actions home-actions">
        <button class="btn primary" data-ir-jogar>Jogar</button>
        <button class="btn ghost" data-toggle-como-jogar>${state.mostrarComoJogar ? "Fechar" : "Como jogar"}</button>
        <button class="btn ghost" data-ir-ranking>🏆 Ranking</button>
      </div>
      ${state.mostrarComoJogar ? comoJogarHTML() : ""}
    </div>`;
}

function wireHome() {
  const jogar = document.querySelector("[data-ir-jogar]");
  if (jogar) jogar.addEventListener("click", () => { state.screen = "menu"; render(); });
  const ranking = document.querySelector("[data-ir-ranking]");
  if (ranking) ranking.addEventListener("click", () => { state.screen = "ranking"; render(); });
  const comoJogar = document.querySelector("[data-toggle-como-jogar]");
  if (comoJogar) comoJogar.addEventListener("click", () => { state.mostrarComoJogar = !state.mostrarComoJogar; render(); });
}

/* ---------------- Ranking ---------------- */
function renderRanking() {
  const ranking = carregarRanking();
  return `
    <p class="stage-kicker">Seus desafios</p>
    <h1 class="stage-title">Ranking</h1>
    <p class="stage-hint">Cada desafio sorteia ${DESAFIO_TAMANHO} casos aleatórios e vira uma nota final, igual boletim. Precisa de ${NOTA_MINIMA_APROVACAO} pra passar.</p>
    ${ranking.length === 0 ? `
      <p class="stage-hint">Nenhum desafio concluído ainda. Jogue um em "Jogar → Desafio" pra aparecer aqui.</p>
    ` : `
      <ol class="ranking-list">${ranking.map((r, i) => `
        <li class="ranking-item">
          <span class="ranking-pos">#${i + 1}</span>
          <span class="ranking-pontos ${r.passou ? "" : "reprovado"}">${r.notaFinal.toFixed(1)}${r.viaRecuperacao ? " (rec.)" : ""}</span>
          <span class="ranking-meta">${r.passou ? "Aprovado" : "Reprovado"} · ${r.acertos}/${r.nCasos} diagnósticos certos · ${new Date(r.data).toLocaleDateString("pt-BR")}</span>
        </li>
      `).join("")}</ol>
    `}
    <div class="actions"><button class="btn ghost" data-voltar-home>Voltar</button></div>`;
}

function wireRanking() {
  const voltar = document.querySelector("[data-voltar-home]");
  if (voltar) voltar.addEventListener("click", voltarHome);
}

function comoJogarHTML() {
  return `
    <div class="intro-panel">
      <p class="intro-panel-title">Como jogar</p>
      <p>Você é o médico(a). Cada caso simula um paciente chegando com uma queixa, e você percorre <strong>6 etapas</strong> até fechar o diagnóstico e a conduta: anamnese → exame físico → hipóteses diagnósticas → exames complementares → diagnóstico final → conduta. Dá pra voltar etapas anteriores a qualquer momento pra reler o que já descobriu.</p>
      <p><strong>Nota</strong> (no topo da tela) é o seu orçamento durante o caso. Cada pergunta, manobra de exame ou exame complementar consome um pouco, relevante ou não. Mas atenção: a nota final do caso não premia quem simplesmente não investiga nada, o bônus de eficiência só conta pontos por achado <strong>relevante</strong> que você realmente foi atrás, descontando o que foi gasto à toa em distratores. Ou seja: dá pra reprovar por excesso de investigação desnecessária e por preguiça de investigar.</p>
      <p>O professor <strong>Burns</strong> comenta em alguns momentos do caso, e você pode clicar em <strong>"Pedir dica ao Burns"</strong> quando estiver travado. As dicas nunca entregam o diagnóstico, só apontam a direção do raciocínio.</p>
      <p>No <strong>Desafio</strong>, o jogo sorteia ${DESAFIO_TAMANHO} casos aleatórios (sem repetir) e sua <strong>nota final</strong> é a média de todos. Precisa de <strong>${NOTA_MINIMA_APROVACAO}</strong> pra passar, igual UC3 de verdade. Reprovou? Você pode tentar uma <strong>recuperação</strong>: ${RECUPERACAO_TAMANHO} casos difíceis, precisa acertar o diagnóstico de pelo menos ${RECUPERACAO_MINIMO_ACERTOS} pra passar. Se passar, sua nota final vira exatamente ${NOTA_APROVACAO_RECUPERACAO}.</p>
    </div>`;
}

function renderMenu() {
  if (casesIndex.length === 0) {
    return `
      <p class="stage-kicker">Casos</p>
      <h1 class="stage-title">Nenhum caso disponível</h1>
      <p class="stage-hint">Não encontrei cases/index.json ou ele está vazio. Gere um caso com tools/generate_case.py ou confira o arquivo.</p>
      <div class="actions"><button class="btn ghost" data-voltar-home>Voltar</button></div>`;
  }
  const tab = state.menuTab || "prova";
  return `
    <div class="menu-tabs">
      <button class="menu-tab ${tab === "prova" ? "active" : ""}" data-tab="prova">Por prova/tema</button>
      <button class="menu-tab ${tab === "area" ? "active" : ""}" data-tab="area">Por área médica</button>
      <button class="menu-tab ${tab === "desafio" ? "active" : ""}" data-tab="desafio">🎲 Desafio</button>
    </div>
    ${tab === "desafio" ? renderDesafioMenu() : renderListaAgrupada(tab)}`;
}

function renderListaAgrupada(tab) {
  const chave = tab === "area" ? "area" : "prova";
  const grupos = {};
  casesIndex.forEach(c => {
    const k = c[chave] || "Sem categoria";
    (grupos[k] = grupos[k] || []).push(c);
  });
  const chaves = Object.keys(grupos).sort();
  return `
    <p class="stage-kicker">Escolha um caso</p>
    <h1 class="stage-title">Casos clínicos disponíveis</h1>
    <p class="stage-hint">Cada caso é independente, com seu próprio orçamento de investigação (Nota).</p>
    ${chaves.map(k => `
      <p class="group-title">${k}</p>
      <ul class="case-list">${grupos[k].map(c => `
        <li><button class="case-card" data-caso="${c.arquivo}">
          <span class="tema">${c.tema}</span>
          <span class="meta">Dificuldade: ${c.dificuldade}</span>
        </button></li>
      `).join("")}</ul>
    `).join("")}
    <div class="actions"><button class="btn ghost" data-voltar-home>Voltar</button></div>`;
}

function renderDesafioMenu() {
  if (avaliacaoAtual && avaliacaoAtual.indice < avaliacaoAtual.arquivos.length) {
    const rotulo = avaliacaoAtual.tipo === "recuperacao" ? "Recuperação em andamento" : "Desafio em andamento";
    return `
      <p class="stage-kicker">${rotulo}</p>
      <h1 class="stage-title">Caso ${avaliacaoAtual.indice + 1} de ${avaliacaoAtual.arquivos.length}</h1>
      <div class="actions">
        <button class="btn primary" data-avaliacao-continuar>Continuar</button>
        <button class="btn ghost" data-avaliacao-abandonar>Abandonar</button>
      </div>`;
  }
  const provas = [...new Set(casesIndex.map(c => c.prova).filter(Boolean))].sort();
  const temasDisponiveis = [...new Set(
    casesIndex.filter(c => !desafioFiltro.prova || c.prova === desafioFiltro.prova).map(c => c.tema)
  )].sort();
  const nCasos = casesFiltrados().length;

  return `
    <p class="stage-kicker">Desafio</p>
    <h1 class="stage-title">Teste seus conhecimentos</h1>
    <p class="stage-hint">Sorteia até ${DESAFIO_TAMANHO} casos aleatórios do banco filtrado abaixo (sem repetir). A média vira sua nota final, precisa de ${NOTA_MINIMA_APROVACAO} pra passar, igual UC3 de verdade.</p>
    <div class="desafio-filtros">
      <label class="desafio-filtro-label">Prova
        <select data-desafio-filtro-prova>
          <option value="">Todos os temas (qualquer prova)</option>
          ${provas.map(p => `<option value="${p}" ${desafioFiltro.prova === p ? "selected" : ""}>${p === "Todas" ? "Cai em todas as provas" : p}</option>`).join("")}
        </select>
      </label>
      <label class="desafio-filtro-label">Tema
        <select data-desafio-filtro-tema>
          <option value="">Todos os temas</option>
          ${temasDisponiveis.map(t => `<option value="${t}" ${desafioFiltro.tema === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
    </div>
    <p class="stage-hint">${nCasos} caso(s) disponível(is) com esse filtro.</p>
    <div class="actions">
      <button class="btn primary" data-desafio-iniciar ${nCasos === 0 ? "disabled" : ""}>🎲 Sortear novo desafio</button>
      <button class="btn ghost" data-voltar-home>Voltar</button>
    </div>`;
}

function renderStage(stage) {
  const caso = state.caso;
  const voltarBtn = state.stageIdx > 0 ? `<button class="btn ghost" data-back>Voltar</button>` : "";
  switch (stage) {
    case "intro": return `
      <p class="stage-kicker">Etapa 01 · Apresentação</p>
      <h1 class="stage-title">Paciente ${caso.paciente.idade > 1 ? `${caso.paciente.idade} anos` : caso.paciente.idade === 1 ? "1 ano" : "lactente"}, ${caso.paciente.sexo === "M" ? "masculino" : "feminino"}</h1>
      <p class="stage-hint">Sem custo: é o que já chega pronto quando o paciente entra na sala.</p>
      <blockquote class="q">${caso.queixa_principal}</blockquote>
      ${vitalsHTML()}
      <div class="actions">${voltarBtn}<button class="btn primary" data-next>Iniciar anamnese</button></div>`;

    case "anamnese": return `
      <p class="stage-kicker">Etapa 02 · Anamnese dirigida</p>
      <h1 class="stage-title">O que você pergunta?</h1>
      <p class="stage-hint">Cada pergunta custa nota, relevante ou não. Escolha com critério.</p>
      <ul class="opts">${caso.anamnese.map((q, i) => optRow(i, q.texto, q.custo, state.anamnesePicked.includes(i))).join("")}</ul>
      <div class="actions">${voltarBtn}<button class="btn primary" data-next>Ir pro exame físico</button></div>`;

    case "exame": return `
      <p class="stage-kicker">Etapa 03 · Exame físico</p>
      <h1 class="stage-title">O que você examina?</h1>
      <p class="stage-hint">Manobras e achados, mesmo custo pras relevantes e pras distratoras.</p>
      <ul class="opts">${caso.exameFisico.map((q, i) => optRow(i, q.texto, q.custo, state.examePicked.includes(i))).join("")}</ul>
      <div class="actions">${voltarBtn}<button class="btn primary" data-next>Formular hipóteses</button></div>`;

    case "hipoteses": return `
      <p class="stage-kicker">Etapa 04 · Hipóteses diagnósticas</p>
      <h1 class="stage-title">Até 3 suspeitas, em ordem</h1>
      <p class="stage-hint">Não custa nota, mas a ordem em que você escolhe define o placar. A primeira é sua principal suspeita.</p>
      <ul class="opts">${caso.hipoteses.map((h, i) => rankRow(i, h.texto)).join("")}</ul>
      <div class="actions">${voltarBtn}<button class="btn primary" data-next ${state.hipotesesPicked.length === 0 ? "disabled" : ""}>Pedir exames complementares</button></div>`;

    case "exames": return `
      <p class="stage-kicker">Etapa 05 · Exames complementares</p>
      <h1 class="stage-title">O que você solicita?</h1>
      <p class="stage-hint">Custo mais alto: pedir o exame errado gasta nota e não ajuda em nada.</p>
      <ul class="opts">${caso.exames.map((q, i) => optRow(i, q.texto, q.custo, state.examesPicked.includes(i))).join("")}</ul>
      <div class="actions">${voltarBtn}<button class="btn primary" data-next>Fechar diagnóstico</button></div>`;

    case "diagnostico": return `
      <p class="stage-kicker">Etapa 06 · Diagnóstico final</p>
      <h1 class="stage-title">Qual é o diagnóstico?</h1>
      <p class="stage-hint">Decisão única, mas ainda dá pra revisar as etapas anteriores antes de confirmar.</p>
      <ul class="opts">${caso.hipoteses.map((h, i) => singleRow("diagnostico", i, h.texto, state.diagnostico === i)).join("")}</ul>
      <div class="actions">${voltarBtn}<button class="btn primary" data-next ${state.diagnostico === null ? "disabled" : ""}>Definir conduta</button></div>`;

    case "conduta": return `
      <p class="stage-kicker">Etapa 06 · Conduta</p>
      <h1 class="stage-title">E agora, o que você faz?</h1>
      <p class="stage-hint">Última decisão do caso.</p>
      <ul class="opts">${caso.condutas.map((c, i) => singleRow("conduta", i, c.texto, state.conduta === i)).join("")}</ul>
      <div class="actions">${voltarBtn}<button class="btn primary" data-next ${state.conduta === null ? "disabled" : ""}>Ver resultado</button></div>`;

    case "resultado": return renderResultado();
  }
}

function optRow(i, texto, custo, picked) {
  return `<li><button class="opt-btn ${picked ? "picked" : ""}" data-opt="${i}"><span>${texto}</span><span class="cost">-${custo}</span></button>${picked ? `<div class="reveal">${revealFor(texto)}</div>` : ""}</li>`;
}

function revealFor(texto) {
  const caso = state.caso;
  const all = [...caso.anamnese, ...caso.exameFisico, ...caso.exames];
  const item = all.find(x => x.texto === texto);
  return item ? item.resposta : "";
}

function rankRow(i, texto) {
  const pos = state.hipotesesPicked.indexOf(i);
  const picked = pos !== -1;
  return `<li><button class="opt-btn ${picked ? "picked" : ""}" data-rank="${i}">${picked ? `<span class="rank">${pos + 1}</span>` : ""}<span style="flex:1">${texto}</span></button></li>`;
}

function singleRow(group, i, texto, picked) {
  return `<li><button class="opt-btn ${picked ? "picked" : ""}" data-single="${group}:${i}">${texto}</button></li>`;
}

function wireMenu() {
  document.querySelectorAll("[data-caso]").forEach(btn => {
    btn.addEventListener("click", () => selecionarCaso(btn.dataset.caso, null));
  });
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => { state.menuTab = btn.dataset.tab; render(); });
  });
  const voltar = document.querySelector("[data-voltar-home]");
  if (voltar) voltar.addEventListener("click", voltarHome);
  const desafioIniciar = document.querySelector("[data-desafio-iniciar]");
  if (desafioIniciar) desafioIniciar.addEventListener("click", () => iniciarDesafio(DESAFIO_TAMANHO));
  const filtroProva = document.querySelector("[data-desafio-filtro-prova]");
  if (filtroProva) filtroProva.addEventListener("change", () => {
    desafioFiltro.prova = filtroProva.value || null;
    desafioFiltro.tema = null; // muda a prova -> lista de temas muda, evita combinação inválida
    render();
  });
  const filtroTema = document.querySelector("[data-desafio-filtro-tema]");
  if (filtroTema) filtroTema.addEventListener("change", () => {
    desafioFiltro.tema = filtroTema.value || null;
    render();
  });
  const avaliacaoContinuar = document.querySelector("[data-avaliacao-continuar]");
  if (avaliacaoContinuar) avaliacaoContinuar.addEventListener("click", jogarProximaDaAvaliacao);
  const avaliacaoAbandonar = document.querySelector("[data-avaliacao-abandonar]");
  if (avaliacaoAbandonar) avaliacaoAbandonar.addEventListener("click", () => { avaliacaoAtual = null; render(); });
}

function wireStage(stage) {
  const caso = state.caso;
  document.querySelectorAll("[data-opt]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = +btn.dataset.opt;
      const listName = stage === "anamnese" ? "anamnesePicked" : stage === "exame" ? "examePicked" : "examesPicked";
      const src = stage === "anamnese" ? caso.anamnese : stage === "exame" ? caso.exameFisico : caso.exames;
      const already = state[listName].includes(i);
      if (already) {
        state[listName] = state[listName].filter(x => x !== i);
        state.pi += src[i].custo;
      } else {
        if (state.pi < src[i].custo) return;
        state[listName].push(i);
        gastarPI(src[i].custo);
      }
      render();
    });
  });
  document.querySelectorAll("[data-rank]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = +btn.dataset.rank;
      const pos = state.hipotesesPicked.indexOf(i);
      if (pos !== -1) state.hipotesesPicked.splice(pos, 1);
      else if (state.hipotesesPicked.length < 3) state.hipotesesPicked.push(i);
      render();
    });
  });
  document.querySelectorAll("[data-single]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [group, iStr] = btn.dataset.single.split(":");
      state[group] = +iStr;
      render();
    });
  });
  const back = document.querySelector("[data-back]");
  if (back) back.addEventListener("click", () => { state.stageIdx = Math.max(0, state.stageIdx - 1); render(); });
  const next = document.querySelector("[data-next]");
  if (next) next.addEventListener("click", () => { state.stageIdx++; render(); });
  const again = document.querySelector("[data-again]");
  if (again) again.addEventListener("click", () => novoJogo(caso, null));
  const menu = document.querySelector("[data-menu]");
  if (menu) menu.addEventListener("click", voltarMenu);
  const dica = document.querySelector("[data-dica]");
  if (dica) dica.addEventListener("click", pedirDica);
  const fecharDicaBtn = document.querySelector("[data-fechar-dica]");
  if (fecharDicaBtn) fecharDicaBtn.addEventListener("click", fecharDica);
  const toggleRevisao = document.querySelector("[data-toggle-revisao]");
  if (toggleRevisao) toggleRevisao.addEventListener("click", () => { state.mostrarRevisao = !state.mostrarRevisao; render(); });
  const avaliacaoNext = document.querySelector("[data-avaliacao-next]");
  if (avaliacaoNext) avaliacaoNext.addEventListener("click", jogarProximaDaAvaliacao);
  const irRecuperacao = document.querySelector("[data-ir-recuperacao]");
  if (irRecuperacao) irRecuperacao.addEventListener("click", () => iniciarRecuperacao(+irRecuperacao.dataset.notaOriginal));
  const novoDesafio = document.querySelector("[data-novo-desafio]");
  if (novoDesafio) novoDesafio.addEventListener("click", () => { avaliacaoAtual = null; iniciarDesafio(DESAFIO_TAMANHO); });
  const irRankingBtn = document.querySelector("[data-ir-ranking-pos-jogo]");
  if (irRankingBtn) irRankingBtn.addEventListener("click", () => { avaliacaoAtual = null; state.screen = "ranking"; render(); });
}

/* Eficiência da investigação: NÃO é mais "quanta nota sobrou" (isso premiava
   quem não perguntava nada e não examinava nada, mesmo acertando tudo no
   chute — ganhava o bônus cheio do mesmo jeito). Agora é baseada em quantos
   dos itens REALMENTE relevantes do caso foram investigados, descontando
   itens irrelevantes escolhidos — precisa investigar direito pra pontuar
   aqui, não só evitar gastar. */
function calcularEficiencia(caso) {
  const todos = [
    ...caso.anamnese.map((it, i) => ({ it, escolhido: state.anamnesePicked.includes(i) })),
    ...caso.exameFisico.map((it, i) => ({ it, escolhido: state.examePicked.includes(i) })),
    ...caso.exames.map((it, i) => ({ it, escolhido: state.examesPicked.includes(i) })),
  ];
  const relevantes = todos.filter(x => x.it.relevante);
  const relevantesEscolhidos = relevantes.filter(x => x.escolhido).length;
  const irrelevantesEscolhidos = todos.filter(x => !x.it.relevante && x.escolhido).length;

  const cobertura = relevantes.length > 0 ? relevantesEscolhidos / relevantes.length : 1;
  const bruto = cobertura * 100 - irrelevantesEscolhidos * 10;
  return Math.max(0, Math.round(bruto));
}

function renderResultado() {
  const caso = state.caso;
  const diagCorretoIdx = caso.hipoteses.findIndex(h => h.correta);
  const hipListaCerta = state.hipotesesPicked.includes(diagCorretoIdx);
  const hipPrimeiraCerta = state.hipotesesPicked[0] === diagCorretoIdx;
  const diagCerto = state.diagnostico === diagCorretoIdx;
  const condutaCerta = caso.condutas[state.conduta]?.correta;

  const pts = {
    hip: hipListaCerta ? 30 : 0,
    hip1: hipPrimeiraCerta ? 20 : 0,
    diag: diagCerto ? 40 : 0,
    cond: condutaCerta ? 30 : 0,
    efic: calcularEficiencia(caso),
  };
  const total = pts.hip + pts.hip1 + pts.diag + pts.cond + pts.efic;

  // Numa avaliação (desafio/recuperação), o progresso é aplicado uma única
  // vez (avaliacaoAplicada evita contar de novo se a tela re-renderizar,
  // ex.: ao abrir a revisão).
  if (state.modoAvaliacao && !state.avaliacaoAplicada && avaliacaoAtual) {
    avaliacaoAtual.somaTotais += total;
    if (diagCerto) avaliacaoAtual.acertos++;
    avaliacaoAtual.indice++;
    state.avaliacaoAplicada = true;
  }

  return `
    <p class="stage-kicker">Resultado</p>
    <h1 class="stage-title">${diagCerto ? "Diagnóstico correto" : "Não foi dessa vez"}</h1>
    <p class="stage-hint">O diagnóstico era <strong>${caso.hipoteses[diagCorretoIdx].texto}</strong>.</p>
    <p style="font-family:'IBM Plex Sans',sans-serif;font-size:14.5px;color:var(--ink-muted)">${caso.explicacao}</p>
    ${caso.materia_relacionada ? `<div class="materia-panel"><p class="materia-panel-title">📚 Relação com a matéria</p><p>${caso.materia_relacionada}</p></div>` : ""}
    <table class="result-table">
      <tr><td>Hipótese correta listada</td><td>${hipListaCerta ? "+30" : "0"}</td></tr>
      <tr><td>Hipótese correta em 1º lugar</td><td>${hipPrimeiraCerta ? "+20" : "0"}</td></tr>
      <tr><td>Diagnóstico final correto</td><td>${diagCerto ? "+40" : "0"}</td></tr>
      <tr><td>Conduta correta</td><td>${condutaCerta ? "+30" : "0"}</td></tr>
      <tr><td>Eficiência (achados relevantes investigados, sem desperdício)</td><td>+${pts.efic}</td></tr>
      <tr class="total"><td>Nota do caso</td><td>${notaDoTotal(total).toFixed(1)} / 10</td></tr>
    </table>
    <button class="hint-btn" data-toggle-revisao>${state.mostrarRevisao ? "Esconder revisão detalhada" : "📋 Ver revisão detalhada do caso"}</button>
    ${state.mostrarRevisao ? revisaoDetalhadaHTML(diagCorretoIdx, diagCerto, condutaCerta) : ""}
    ${state.modoAvaliacao ? avaliacaoResultActionsHTML() : `
    <div class="actions">
      <button class="btn primary" data-again>Jogar de novo</button>
      <button class="btn ghost" data-menu>Escolher outro caso</button>
    </div>`}
  `;
}

/* Revisão item a item: o que foi escolhido, se era relevante, e o que foi
   deixado de fora que fazia diferença — pra reforçar aprendizado, não só
   pontuação. */
function secaoRevisaoHTML(titulo, itens, escolhidos) {
  return `
    <div class="revisao-secao">
      <p class="revisao-titulo">${titulo}</p>
      <ul class="revisao-list">${itens.map((it, i) => {
        const escolhido = escolhidos.includes(i);
        const cls = escolhido ? (it.relevante ? "certo" : "gasto") : (it.relevante ? "perdido" : "neutro");
        const marca = escolhido ? (it.relevante ? "✓" : "!") : (it.relevante ? "○" : "–");
        const detalhe = escolhido
          ? it.resposta
          : (it.relevante ? `Você não pediu isso, era relevante: ${it.resposta}` : "Distrator: bom não ter gastado nota aqui.");
        return `<li class="revisao-item ${cls}"><span class="revisao-marca">${marca}</span><span class="revisao-corpo"><span class="revisao-texto">${it.texto}</span><span class="revisao-resposta">${detalhe}</span></span></li>`;
      }).join("")}</ul>
    </div>`;
}

function revisaoDetalhadaHTML(diagCorretoIdx, diagCerto, condutaCerta) {
  const caso = state.caso;
  return `
    <div class="revisao-wrap">
      ${secaoRevisaoHTML("Anamnese", caso.anamnese, state.anamnesePicked)}
      ${secaoRevisaoHTML("Exame físico", caso.exameFisico, state.examePicked)}
      ${secaoRevisaoHTML("Exames complementares", caso.exames, state.examesPicked)}
      <div class="revisao-secao">
        <p class="revisao-titulo">Hipóteses que você listou (em ordem)</p>
        <ol class="revisao-list-simples">
          ${state.hipotesesPicked.length === 0 ? "<li>Nenhuma hipótese listada.</li>" : state.hipotesesPicked.map(i => `<li>${caso.hipoteses[i].texto}${caso.hipoteses[i].correta ? " (<strong>correta</strong>)" : ""}</li>`).join("")}
        </ol>
      </div>
      <div class="revisao-secao">
        <p class="revisao-titulo">Diagnóstico final</p>
        <p>Você escolheu: <strong>${caso.hipoteses[state.diagnostico]?.texto ?? "(nenhum)"}</strong> ${diagCerto ? "✓" : `✗ (o correto era ${caso.hipoteses[diagCorretoIdx].texto})`}</p>
      </div>
      <div class="revisao-secao">
        <p class="revisao-titulo">Conduta</p>
        <p>Você escolheu: <strong>${caso.condutas[state.conduta]?.texto ?? "(nenhuma)"}</strong> ${condutaCerta ? "✓" : "✗"}</p>
      </div>
    </div>`;
}

/* Ações da tela de resultado quando o caso foi jogado dentro de uma
   avaliação (desafio ou recuperação): ou segue pro próximo caso, ou — se
   esse era o último — fecha a avaliação (nota final, aprovação, ranking). */
function avaliacaoResultActionsHTML() {
  if (!avaliacaoAtual) return `<div class="actions"><button class="btn ghost" data-menu>Voltar ao menu</button></div>`;

  if (avaliacaoAtual.indice < avaliacaoAtual.arquivos.length) {
    return `
      <div class="actions">
        <button class="btn primary" data-avaliacao-next>Próximo caso (${avaliacaoAtual.indice + 1}/${avaliacaoAtual.arquivos.length})</button>
        <button class="btn ghost" data-menu>Pausar e voltar ao menu</button>
      </div>`;
  }

  if (avaliacaoAtual.tipo === "recuperacao") {
    const passouRecuperacao = avaliacaoAtual.acertos >= RECUPERACAO_MINIMO_ACERTOS;
    const notaFinal = passouRecuperacao ? NOTA_APROVACAO_RECUPERACAO : avaliacaoAtual.notaOriginal;
    if (!avaliacaoAtual.salvo) {
      salvarResultadoRanking({
        notaFinal, passou: passouRecuperacao, nCasos: avaliacaoAtual.arquivos.length,
        acertos: avaliacaoAtual.acertos, viaRecuperacao: true, data: Date.now(),
      });
      avaliacaoAtual.salvo = true;
    }
    return passouRecuperacao ? `
      <div class="campanha-vitoria">
        <img class="burns-sprite" src="assets/burns.png" alt="Burns">
        <div class="bubble"><p class="who">Burns · recuperação</p><p>“Passou na recuperação! ${avaliacaoAtual.acertos} de ${avaliacaoAtual.arquivos.length} diagnósticos certos, dá pra fechar com nota ${NOTA_APROVACAO_RECUPERACAO.toFixed(1)}. Continue estudando, viu?”</p></div>
      </div>
      <p class="stage-hint">Nota final: <strong>${notaFinal.toFixed(1)}</strong>. Aprovado.</p>
      <div class="actions">
        <button class="btn primary" data-novo-desafio>🎲 Jogar outro desafio</button>
        <button class="btn ghost" data-ir-ranking-pos-jogo>Ver ranking</button>
      </div>` : `
      <p class="stage-kicker">Recuperação</p>
      <h1 class="stage-title">Não foi dessa vez</h1>
      <p class="stage-hint">Você acertou ${avaliacaoAtual.acertos} de ${avaliacaoAtual.arquivos.length}, precisava de pelo menos ${RECUPERACAO_MINIMO_ACERTOS}. Nota final: <strong>${notaFinal.toFixed(1)}</strong>. Reprovado.</p>
      <div class="actions">
        <button class="btn primary" data-novo-desafio>🎲 Tentar outro desafio</button>
        <button class="btn ghost" data-ir-ranking-pos-jogo>Ver ranking</button>
      </div>`;
  }

  // Desafio concluído: nota final = média das notas de cada caso.
  const notaFinal = notaDoTotal(avaliacaoAtual.somaTotais / avaliacaoAtual.arquivos.length);
  const passou = notaFinal >= NOTA_MINIMA_APROVACAO;
  if (!avaliacaoAtual.salvo) {
    salvarResultadoRanking({
      notaFinal, passou, nCasos: avaliacaoAtual.arquivos.length,
      acertos: avaliacaoAtual.acertos, viaRecuperacao: false, data: Date.now(),
    });
    avaliacaoAtual.salvo = true;
  }

  if (passou) {
    return `
      <div class="campanha-vitoria">
        <img class="burns-sprite" src="assets/burns.png" alt="Burns">
        <div class="bubble"><p class="who">Burns · fim de jogo</p><p>“Você conseguiu! Finalmente passou na UC3. Reconhecimento de padrão, raciocínio clínico, uso consciente dos recursos disponíveis... você tem tudo isso agora. Parabéns, doutor(a).”</p></div>
      </div>
      <p class="stage-hint">Nota final: <strong>${notaFinal.toFixed(1)}</strong>. Aprovado. ${avaliacaoAtual.acertos}/${avaliacaoAtual.arquivos.length} diagnósticos certos.</p>
      <div class="actions">
        <button class="btn primary" data-novo-desafio>🎲 Jogar outro desafio</button>
        <button class="btn ghost" data-ir-ranking-pos-jogo>Ver ranking</button>
      </div>`;
  }

  if (notaFinal < NOTA_MINIMA_PARA_RECUPERACAO) {
    return `
      <p class="stage-kicker">Resultado do desafio</p>
      <h1 class="stage-title">Reprovado direto</h1>
      <p class="stage-hint">Nota final: <strong>${notaFinal.toFixed(1)}</strong>. Reprovado (precisa de ${NOTA_MINIMA_APROVACAO}). ${avaliacaoAtual.acertos}/${avaliacaoAtual.arquivos.length} diagnósticos certos. Nota abaixo de ${NOTA_MINIMA_PARA_RECUPERACAO}: sem direito a prova de recuperação, igual na UC3 de verdade.</p>
      <div class="actions">
        <button class="btn primary" data-novo-desafio>🎲 Tentar outro desafio</button>
        <button class="btn ghost" data-ir-ranking-pos-jogo>Ver ranking</button>
      </div>`;
  }

  return `
    <p class="stage-kicker">Resultado do desafio</p>
    <h1 class="stage-title">Não foi dessa vez</h1>
    <p class="stage-hint">Nota final: <strong>${notaFinal.toFixed(1)}</strong>. Reprovado (precisa de ${NOTA_MINIMA_APROVACAO}). ${avaliacaoAtual.acertos}/${avaliacaoAtual.arquivos.length} diagnósticos certos.</p>
    <div class="actions">
      <button class="btn primary" data-ir-recuperacao data-nota-original="${notaFinal}">Fazer prova de recuperação (${RECUPERACAO_TAMANHO} casos difíceis)</button>
      <button class="btn ghost" data-novo-desafio>🎲 Tentar outro desafio</button>
    </div>`;
}

boot();
