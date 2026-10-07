-- Banco D1 do modo pesquisa. Criar uma vez:
--   npx wrangler d1 create uc3-pesquisa
--   npx wrangler d1 execute uc3-pesquisa --remote --file=schema.sql
-- Uma linha por evento (caso concluído, desafio ou recuperação). As colunas
-- soltas são as que entram direto na análise; "dados" guarda o registro
-- inteiro em JSON, pra não perder nada que o jogo passe a mandar no futuro.
CREATE TABLE IF NOT EXISTS registros (
  id TEXT PRIMARY KEY,
  recebido_em TEXT NOT NULL,
  ts TEXT NOT NULL,
  codigo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  versao TEXT,
  plataforma TEXT,
  caso_id TEXT,
  prova TEXT,
  dificuldade TEXT,
  modo TEXT,
  duracao_seg INTEGER,
  diag_certo INTEGER,
  conduta_certa INTEGER,
  eficiencia INTEGER,
  nota REAL,
  dicas_usadas INTEGER,
  dados TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registros_codigo ON registros (codigo);
