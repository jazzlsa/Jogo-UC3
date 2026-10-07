/* Configuração do jogo que muda conforme onde ele está publicado.
   pesquisaApi: endereço que recebe os registros do modo pesquisa.
   - "" (vazio): registros ficam só no aparelho (dá pra baixar em .json
     pela tela "Pesquisa").
   - URL completa do servidor no Cloudflare Pages (app/functions/): usada
     por todas as versões (Cloudflare, GitHub Pages, desktop e Android), já
     que o servidor aceita pedidos de qualquer origem.
   Só quem digita um código de participante envia algo, e os códigos só são
   distribuídos depois do TCLE assinado. */
window.UC3_CONFIG = {
  pesquisaApi: "https://grand-round-uc3.pages.dev/api/registro",
  versao: "0.2.0",
};
