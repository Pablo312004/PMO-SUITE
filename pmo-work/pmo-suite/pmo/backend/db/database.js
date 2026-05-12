/**
 * PMO Suite v5.0 — Database (PostgreSQL / Supabase)
 * Substitui sql.js por pg com conexão poolada.
 * Mantém a mesma API: run(), all(), get(), lastId()
 */
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) throw new Error('DB não inicializado. Chame initDb() primeiro.');
  return pool;
}

/** Execute INSERT/UPDATE/DELETE — retorna { id } com o RETURNING id */
async function run(sql, params = []) {
  const client = getPool();
  // Se for INSERT sem RETURNING, adiciona automaticamente
  const q = /^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql)
    ? sql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id'
    : sql;
  const res = await client.query(q, params);
  return res.rows[0]?.id || null;
}

/** SELECT múltiplas linhas */
async function all(sql, params = []) {
  const res = await getPool().query(sql, params);
  return res.rows;
}

/** SELECT uma linha */
async function get(sql, params = []) {
  const res = await getPool().query(sql, params);
  return res.rows[0] || null;
}

/** Compatibilidade legada */
async function lastId() { return null; }

async function initDb() {
  // Suporta DATABASE_URL ou credenciais separadas (DB_HOST, DB_PASSWORD, etc.)
  // Credenciais separadas evitam problema com caracteres especiais na senha
  const config = process.env.DB_HOST
    ? {
        host:     process.env.DB_HOST,
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME     || 'postgres',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
      }
    : {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
      };

  if (!config.connectionString && !config.host) {
    throw new Error(
      'Variáveis de banco não configuradas.\n' +
      'Configure DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD\n' +
      'ou DATABASE_URL nas variáveis de ambiente do Render.'
    );
  }

  pool = new Pool(config);

  // Testa conexão com retry
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const client = await pool.connect();
      const { rows } = await client.query('SELECT NOW() as now');
      client.release();
      console.log(`✅ PostgreSQL conectado — ${rows[0].now}`);
      return { run, all, get, lastId };
    } catch (e) {
      lastErr = e;
      console.log(`⏳ Tentativa ${attempt}/3 falhou: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('Não foi possível conectar ao banco: ' + lastErr.message);
}

module.exports = { initDb, getDb: () => ({ run, all, get, lastId }) };
