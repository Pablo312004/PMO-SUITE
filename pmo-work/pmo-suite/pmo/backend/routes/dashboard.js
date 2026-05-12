const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

module.exports = (db) => {

  /* ── DASHBOARD PRINCIPAL ─────────────────────────────────── */
  router.get('/', authenticate, async (req, res) => {
    try {
      let deptFilter = '';
      const params = [];

      if (req.user.role !== 'admin' && req.user.role !== 'gestor-geral') {
        let depts = [];
        try { depts = Array.isArray(req.user.departments) ? req.user.departments : JSON.parse(req.user.departments || '[]'); } catch {}
        if (depts.length > 1) {
          const phs = depts.map((_, di) => '$' + (di + 1)).join(',');
          deptFilter = ` AND p.area IN (${phs})`;
          depts.forEach(d => params.push(d));
        } else {
          const dept = req.user.active_department || (depts[0] || null);
          if (dept) { deptFilter = ` AND p.area=$1`; params.push(dept); }
        }
      }

      const i = params.length + 1;

      const [summary, byStatus, byArea, overdue, expiring, recentUpdates, topRisks] = await Promise.all([
        // Resumo geral
        db.get(`SELECT
          COUNT(*)                                         AS total_projects,
          COUNT(*) FILTER (WHERE status='Em andamento')    AS active,
          COUNT(*) FILTER (WHERE status='Atrasado')        AS delayed,
          COUNT(*) FILTER (WHERE status='Concluído')       AS done,
          COUNT(*) FILTER (WHERE status='Planejado')       AS planned,
          COALESCE(SUM(budget),0)                          AS total_budget,
          COALESCE(SUM(actual_cost),0)                     AS total_cost,
          ROUND(AVG(progress)::numeric,1)                  AS avg_progress
          FROM projects p WHERE 1=1 ${deptFilter}`, params),

        // Por status
        db.all(`SELECT status, COUNT(*) as count FROM projects p WHERE 1=1 ${deptFilter} GROUP BY status ORDER BY count DESC`, params),

        // Por área (só admins/gestores-gerais veem todos)
        req.user.role === 'admin' || req.user.role === 'gestor-geral'
          ? db.all(`SELECT area, COUNT(*) as count,
              COUNT(*) FILTER (WHERE status='Atrasado') as delayed,
              ROUND(AVG(progress)::numeric,1) as avg_progress,
              COALESCE(SUM(budget),0) as total_budget
              FROM projects WHERE area IS NOT NULL GROUP BY area ORDER BY count DESC`)
          : Promise.resolve([]),

        // Projetos atrasados
        db.all(`SELECT p.id,p.name,p.area,p.progress,p.end_date,p.priority,u.name as manager_name
          FROM projects p LEFT JOIN users u ON u.id=p.manager_id
          WHERE p.status='Atrasado' ${deptFilter} ORDER BY p.end_date NULLS LAST LIMIT 5`, params),

        // Vencendo em 14 dias
        db.all(`SELECT t.id,t.name,t.end_date,t.progress,p.name as project_name,p.area,u.name as assignee_name
          FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assignee_id
          WHERE t.end_date BETWEEN NOW() AND NOW()+INTERVAL '14 days'
            AND t.status != 'Concluído' ${deptFilter.replace('p.area','p.area')}
          ORDER BY t.end_date LIMIT 8`, params),

        // Últimos updates semanais
        db.all(`SELECT w.*,p.name as project_name,p.area,u.name as user_name
          FROM weekly_updates w JOIN projects p ON p.id=w.project_id LEFT JOIN users u ON u.id=w.user_id
          WHERE 1=1 ${deptFilter.replace('p.area=','p.area=')}
          ORDER BY w.created_at DESC LIMIT 6`, params),

        // Riscos críticos ativos
        db.all(`SELECT r.id,r.code,r.description,r.probability,r.impact,(r.probability*r.impact) as severity,
            r.status,p.name as project_name,p.area
          FROM risks r JOIN projects p ON p.id=r.project_id
          WHERE r.status='Ativo' AND r.probability*r.impact>=12 ${deptFilter.replace('p.area','p.area')}
          ORDER BY severity DESC LIMIT 5`, params),
      ]);

      res.json({ summary, byStatus, byArea, overdue, expiring, recentUpdates, topRisks });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── VISÃO CONSOLIDADA POR ÁREA (diretoria) ──────────────── */
  router.get('/by-area', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'gestor-geral')
        return res.status(403).json({ error: 'Acesso restrito' });

      const areas = await db.all(`
        SELECT
          p.area,
          COUNT(*)                                                          AS total,
          COUNT(*) FILTER (WHERE p.status='Em andamento')                  AS active,
          COUNT(*) FILTER (WHERE p.status='Atrasado')                      AS delayed,
          COUNT(*) FILTER (WHERE p.status='Concluído')                     AS done,
          ROUND(AVG(p.progress)::numeric,1)                                AS avg_progress,
          COALESCE(SUM(p.budget),0)                                        AS total_budget,
          COALESCE(SUM(p.actual_cost),0)                                   AS total_cost,
          COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'Concluído')      AS open_tasks,
          COUNT(DISTINCT r.id) FILTER (WHERE r.status='Ativo')             AS active_risks
        FROM projects p
          LEFT JOIN tasks t ON t.project_id=p.id
          LEFT JOIN risks r ON r.project_id=p.id
        WHERE p.area IS NOT NULL
        GROUP BY p.area
        ORDER BY delayed DESC, avg_progress ASC
      `);
      res.json(areas);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── NOTIFICAÇÕES ────────────────────────────────────────── */
  router.get('/notifications', authenticate, async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [req.user.id]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/notifications/:id/read', authenticate, async (req, res) => {
    try {
      await db.run('UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      res.json({ message: 'ok' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/notifications/read-all', authenticate, async (req, res) => {
    try {
      await db.run('UPDATE notifications SET read=TRUE WHERE user_id=$1', [req.user.id]);
      res.json({ message: 'ok' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── AUDIT LOG ───────────────────────────────────────────── */
  router.get('/audit', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito' });
      const rows = await db.all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100');
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
