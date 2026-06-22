/**
 * PMO Suite — Reset do Banco de Dados
 * ------------------------------------
 * Apaga todos os dados e recria o banco do zero.
 * Mantém apenas o usuário admin para login imediato.
 *
 * Uso:
 *   node db/reset-db.js
 *
 * Após o reset, faça login com:
 *   Email: admin@pmo.com
 *   Senha: admin123
 */

require('dotenv').config();
const { initDb } = require('./database');
const bcrypt = require('bcryptjs');

async function reset() {
  const db = await initDb();

  console.log('🗑️  Limpando todos os dados...');

  // Apaga na ordem correta (respeitar FK)
  const tables = [
    'import_logs',
    'oauth_states',
    'calendar_events',
    'cost_entries',
    'change_requests',
    'notifications',
    'audit_log',
    'weekly_updates',
    'resource_projects',
    'resources',
    'risks',
    'tasks',
    'project_dependencies',
    'projects',
    'refresh_tokens',
    'users',
  ];

  for (const table of tables) {
    db.run(`DELETE FROM ${table}`);
    db.run(`DELETE FROM sqlite_sequence WHERE name='${table}'`);
  }

  console.log('✅ Banco limpo.');

  // Recria apenas o usuário admin
  const adminPw = bcrypt.hashSync('admin123', 10);
  db.run(
    `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
    ['Admin PMO', 'admin@pmo.com', adminPw, 'admin']
  );

  console.log('');
  console.log('✅ Reset concluído! Banco de dados vazio e pronto para uso.');
  console.log('');
  console.log('  🔑 Login:');
  console.log('     Email : admin@pmo.com');
  console.log('     Senha : admin123');
  console.log('');
  console.log('  ➡  Suba o servidor com:  node server.js');
  console.log('  ➡  Importe sua planilha pelo menu "Importar Excel" no topo da tela.');
  console.log('');
  process.exit(0);
}

reset().catch(e => {
  console.error('❌ Erro no reset:', e.message);
  process.exit(1);
});
