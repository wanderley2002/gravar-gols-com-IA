const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function inicializarBanco() {
  // Abre ou cria o arquivo do banco de dados SQLite
  const db = await open({
    filename: './banco.db',
    driver: sqlite3.Database
  });

  // Ativa o suporte a chaves estrangeiras (Impede salvar gols de usuários que não existem)
  await db.exec(`PRAGMA foreign_keys = ON`);

  // Criação da tabela de Usuários (Atletas)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT,
      email TEXT UNIQUE,
      senha TEXT,
      dataRegistro TEXT
    )
  `);

  // Criação da tabela do Ranking de Gols com vínculo ID do Usuário
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ranking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id TEXT,
      nome_jogador TEXT,
      video_url TEXT,
      data_gol TEXT,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);

  return db;
}

module.exports = { inicializarBanco };