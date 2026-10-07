// GET /api/exportar: baixa todos os registros em CSV, pra análise
// (R, SPSS, Excel). Protegido por um token secreto, configurado uma vez com
//   npx wrangler pages secret put EXPORT_TOKEN
// e usado assim:
//   curl -H "Authorization: Bearer <token>" https://<projeto>.pages.dev/api/exportar -o registros.csv
const COLUNAS = [
  "id", "recebido_em", "ts", "codigo", "tipo", "versao", "plataforma", "caso_id", "prova", "dificuldade",
  "modo", "duracao_seg", "diag_certo", "conduta_certa", "eficiencia", "nota", "dicas_usadas", "dados",
];

function celula(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function onRequestGet({ request, env }) {
  const esperado = env.EXPORT_TOKEN;
  const recebido = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!esperado || recebido !== esperado) return new Response("não autorizado", { status: 401 });

  const { results } = await env.DB.prepare(`SELECT ${COLUNAS.join(", ")} FROM registros ORDER BY codigo, ts`).all();
  const linhas = [COLUNAS.join(","), ...results.map(r => COLUNAS.map(c => celula(r[c])).join(","))];
  return new Response(linhas.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registros-uc3-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
