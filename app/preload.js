// Intencionalmente vazio: o jogo não precisa de nenhuma API do Node no
// processo de renderização (contextIsolation: true, nodeIntegration: false)
// — src/engine.js só usa fetch() sobre o protocolo "app://" registrado em
// main.js. Mantido como arquivo separado (em vez de omitir "preload" na
// BrowserWindow) para já ter o lugar certo caso uma API nativa específica do
// desktop (ex.: salvar/exportar um relatório) seja adicionada no futuro.
