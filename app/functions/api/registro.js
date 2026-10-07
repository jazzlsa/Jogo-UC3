// POST /api/registro: recebe um lote de registros do modo pesquisa
// (ver registrarPesquisa() em src/engine.js) e grava no D1.
// Aceita pedido de outra origem (CORS aberto) porque os builds desktop e
// Android não rodam no mesmo domínio do Pages. Não há dado pessoal aqui:
// só o código de participante, cuja chave fica com o pesquisador.
const CODIGO_REGEX = /^[A-Z0-9-]{3,20}$/;
const TIPOS = new Set(["caso", "desafio", "recuperacao"]);
const MAX_LOTE = 100;
const MAX_BYTES = 200_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function resposta(status, corpo) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function inteiroOuNulo(v) {
  return Number.isFinite(v) ? Math.round(v) : null;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const texto = await request.text();
  if (texto.length > MAX_BYTES) return resposta(413, { erro: "lote grande demais" });

  let lote;
  try { lote = JSON.parse(texto); } catch { return resposta(400, { erro: "JSON inválido" }); }
  if (!Array.isArray(lote) || lote.length === 0 || lote.length > MAX_LOTE) {
    return resposta(400, { erro: `envie uma lista de 1 a ${MAX_LOTE} registros` });
  }

  const validos = lote.filter(r =>
    r && typeof r.id === "string" && r.id.length <= 40 &&
    typeof r.codigo === "string" && CODIGO_REGEX.test(r.codigo) &&
    TIPOS.has(r.tipo) && typeof r.ts === "string"
  );
  if (validos.length === 0) return resposta(400, { erro: "nenhum registro válido" });

  const recebidoEm = new Date().toISOString();
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO registros
       (id, recebido_em, ts, codigo, tipo, versao, plataforma, caso_id, prova, dificuldade, modo,
        duracao_seg, diag_certo, conduta_certa, eficiencia, nota, dicas_usadas, dados)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(validos.map(r => stmt.bind(
    r.id, recebidoEm, r.ts.slice(0, 40), r.codigo, r.tipo,
    r.versao ?? null, r.plataforma ?? null, r.casoId ?? null, r.prova ?? null, r.dificuldade ?? null, r.modo ?? null,
    inteiroOuNulo(r.duracaoSeg),
    typeof r.diagCerto === "boolean" ? Number(r.diagCerto) : null,
    typeof r.condutaCerta === "boolean" ? Number(r.condutaCerta) : null,
    inteiroOuNulo(r.eficiencia),
    Number.isFinite(r.nota ?? r.notaFinal) ? (r.nota ?? r.notaFinal) : null,
    inteiroOuNulo(r.dicasUsadas),
    JSON.stringify(r),
  )));

  // "aceitos" inclui repetidos (INSERT OR IGNORE): reenviar o mesmo lote
  // depois de uma falha de rede não duplica nada, e o jogo pode limpar a fila.
  return resposta(200, { aceitos: validos.length, descartados: lote.length - validos.length });
}
