// Processo principal do Electron.
//
// O jogo (src/) é servido por um protocolo customizado "app://" em vez de
// carregado direto via file:// — file:// no Chromium bloqueia fetch() entre
// arquivos locais (o engine.js usa fetch() pra ler cases/index.json e os
// JSONs de cada caso), e um protocolo privilegiado resolve isso sem precisar
// subir um servidor HTTP de verdade. Isso também mantém o src/ idêntico ao
// que roda no Android (Capacitor), no GitHub Pages e num navegador comum —
// o mesmo código, sem variar por plataforma.
const { app, BrowserWindow, protocol, net, Menu } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SRC_DIR = path.join(__dirname, "src");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL("app://local/index.html");
}

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(SRC_DIR, decodeURIComponent(pathname));
    // Guarda simples contra path traversal (ex.: "app://local/../../main.js").
    if (!filePath.startsWith(SRC_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
