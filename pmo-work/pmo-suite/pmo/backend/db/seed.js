/**
 * PMO Suite — Seed de Usuários e Departamentos
 * Senha padrão: Safra@2027
 * Uso:  node db/seed.js
 */
require('dotenv').config();
const { initDb } = require('./database');
const bcrypt = require('bcryptjs');

const SENHA = bcrypt.hashSync('Safra@2027', 10);

const AREAS = [
  'T.I','Controladoria','D.P','Financeiro (Bem Indústrias)',
  'Financeiro (GSM)','Compras','Suprimentos','Produção',
  'Laboratório','Logística','Administrativo','Comercial','Marketing',
];

const USERS = [
  { name:'Admin PMO',    email:'admin@empresa.com',    role:'admin',       departments:[] },
  { name:'Gestor Geral 1',   email:'gestor.geral1@empresa.com',   role:'gestor-geral',departments:AREAS },
  { name:'Gestor Geral 2',    email:'gestor.geral2@empresa.com',    role:'gestor-geral',departments:AREAS },
  { name:'Gestor T.I',     email:'gestor.ti@empresa.com',     role:'gestor',      departments:['T.I'] },
  { name:'Gestor Financeiro',     email:'gestor.financeiro@empresa.com',     role:'gestor',      departments:['T.I','Financeiro (Bem Indústrias)','Financeiro (GSM)','D.P','Controladoria'] },
  { name:'Gestor Comercial',    email:'gestor.comercial@empresa.com',    role:'gestor',      departments:['Comercial','Marketing'] },
  { name:'Gestor Suprimentos', email:'gestor.suprimentos@empresa.com', role:'gestor',      departments:['Suprimentos'] },
  { name:'Gestor Administrativo',     email:'gestor.administrativo@empresa.com',     role:'gestor',      departments:['Administrativo','Logística'] },
  { name:'Gestor Compras',     email:'gestor.compras@empresa.com',     role:'gestor',      departments:['Compras'] },
  { name:'Gestor Producao', email:'gestor.producao@empresa.com', role:'gestor',      departments:['Produção','Laboratório'] },
];

async function seed() {
  const db = await initDb();
  console.log('\n🌱 PMO Suite — Seed de usuários\n');
  let created = 0, updated = 0;

  for (const u of USERS) {
    const depts     = JSON.stringify(u.departments);
    const activeDept = u.departments[0] || null;
    const existing  = db.get('SELECT id FROM users WHERE email=?', [u.email]);
    if (existing) {
      db.run('UPDATE users SET name=?,role=?,departments=?,active_department=?,password=?,is_active=1 WHERE id=?',
        [u.name,u.role,depts,activeDept,SENHA,existing.id]);
      console.log(`  ✏️  Atualizado: ${u.name}`); updated++;
    } else {
      db.run('INSERT INTO users (name,email,password,role,departments,active_department,is_active) VALUES (?,?,?,?,?,?,1)',
        [u.name,u.email,SENHA,u.role,depts,activeDept]);
      console.log(`  ✅ Criado    : ${u.name}`); created++;
    }
    const label = u.departments.length === 0 ? 'Acesso integral'
      : u.departments.length === 1 ? u.departments[0]
      : u.departments.join(', ');
    console.log(`     └─ ${label}\n`);
  }

  console.log(`─────────────────────────────────────`);
  console.log(`${created} criado(s) · ${updated} atualizado(s)`);
  console.log(`Senha padrão: Safra@2027\n`);
  process.exit(0);
}

seed().catch(e => { console.error('❌', e.message); process.exit(1); });
