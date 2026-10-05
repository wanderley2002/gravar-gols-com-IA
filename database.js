/**
 * ============================================================
 *  W.A GAMES — BASE DE DATOS (SQLite)
 *  ------------------------------------------------------------
 *  Crea/abre el archivo `banco.db` y define las tablas:
 *   - usuarios : cuentas de los atletas (id, nome, email, senha)
 *   - ranking  : goles detectados por usuario
 * ============================================================
 */

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function inicializarBanco() {
  // Abre o crea el archivo de la base de datos SQLite
  const db = await open({
    filename: './banco.db',
    driver: sqlite3.Database
  });

  // Activa el soporte de claves foraneas
  // (impide guardar goles de usuarios que no existen)
  await db.exec(`PRAGMA foreign_keys = ON`);

  // Tabla de Usuarios (Atletas)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      dataRegistro TEXT
    )
  `);

  // Tabla del Ranking de Goles, vinculada al usuario que los marco
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