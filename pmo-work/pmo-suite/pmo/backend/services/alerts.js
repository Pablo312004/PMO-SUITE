/**
 * PMO Suite — Alert Scheduler
 * Roda a cada hora: detecta atrasos, prazos próximos e riscos críticos
 */
let _db  = null;
let _email = null;

function getEmail() {
  if (!_email) {
    try { _email = require('./email'); } catch { _email = {}; }
  }
  return _email;
}

async function runAlerts() {
  if (!_db) return;
  const today = new Date().toISOString().split('T')[0];
  try {
    // 1. Marcar projetos atrasados automaticamente
    await _db.run(
      `UPDATE projects SET status='Atrasado'
       WHERE status='Em andamento' AND end_date < $1 AND progress < 100`,
      [today]
    );

    // 2. Notificar gestores de projetos atrasados
    const delayed = await _db.all(
      `SELECT p.*, u.id as mid FROM projects p LEFT JOIN users u ON u.id=p.manager_id
       WHERE p.status='Atrasado' AND p.manager_id IS NOT NULL`
    );
    for (const p of delayed) {
      const exists = await _db.get(
        `SELECT id FROM notifications WHERE user_id=$1 AND type='delay' AND title LIKE $2
         AND created_at > NOW()-INTERVAL '24 hours'`,
        [p.mid, `%${p.name}%`]
      );
      if (!exists) {
        await _db.run(
          'INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
          [p.mid, 'delay', `Projeto atrasado: ${p.name}`, `O projeto está abaixo do progresso esperado e com prazo vencido.`]
        );
      }
    }

    // 3. Alertar sobre tarefas vencendo em 3 dias
    const expiring = await _db.all(
      `SELECT t.*, p.name as pname, p.manager_id
       FROM tasks t JOIN projects p ON p.id=t.project_id
       WHERE t.end_date BETWEEN NOW() AND NOW()+INTERVAL '3 days'
         AND t.status != 'Concluído' AND p.manager_id IS NOT NULL`
    );
    for (const t of expiring) {
      const exists = await _db.get(
        `SELECT id FROM notifications WHERE user_id=$1 AND type='deadline' AND title LIKE $2
         AND created_at > NOW()-INTERVAL '24 hours'`,
        [t.manager_id, `%${t.name}%`]
      );
      if (!exists) {
        await _db.run(
          'INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
          [t.manager_id, 'deadline', `Prazo próximo: ${t.name}`,
           `Tarefa do projeto "${t.pname}" vence em até 3 dias.`]
        );
      }
    }

    // 4. Notificar riscos críticos ativos (probabilidade × impacto >= 15)
    const critRisks = await _db.all(
      `SELECT r.*, p.manager_id, p.name as pname FROM risks r
       JOIN projects p ON p.id=r.project_id
       WHERE r.status='Ativo' AND r.probability*r.impact>=15 AND p.manager_id IS NOT NULL`
    );
    for (const r of critRisks) {
      const exists = await _db.get(
        `SELECT id FROM notifications WHERE user_id=$1 AND type='risk' AND title LIKE $2
         AND created_at > NOW()-INTERVAL '24 hours'`,
        [r.manager_id, `%${r.description.slice(0,30)}%`]
      );
      if (!exists) {
        await _db.run(
          'INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
          [r.manager_id, 'risk', `Risco crítico: ${r.pname}`, r.description]
        );
      }
    }

    console.log(`[alerts] ${new Date().toLocaleTimeString('pt-BR')} — ${delayed.length} atrasado(s), ${expiring.length} vencendo, ${critRisks.length} risco(s) crítico(s)`);

  // Relatório semanal toda segunda-feira às 8h
  const now2 = new Date();
  if (now2.getDay() === 1 && now2.getHours() === 8) {
    const stats = await _db.get(`SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status='Em andamento') as active,
      COUNT(*) FILTER (WHERE status='Atrasado') as delayed,
      COUNT(*) FILTER (WHERE status='Concluído') as done,
      ROUND(AVG(progress)::numeric,1) as avg_progress
      FROM projects`).catch(() => null);
    if (stats) getEmail().notifyWeeklyReport?.(stats).catch(() => {});
  }
  } catch (e) { console.error('[alerts]', e.message); }
}

function startScheduler(db) {
  _db = db;
  runAlerts(); // roda imediatamente no start
  setInterval(runAlerts, 60 * 60 * 1000); // a cada hora
  console.log('⏰ Alert scheduler iniciado');
}

module.exports = { startScheduler, runAlerts };
