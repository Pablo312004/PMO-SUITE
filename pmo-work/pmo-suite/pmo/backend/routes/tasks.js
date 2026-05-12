const router = require('express').Router();
const { authenticate, audit } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

module.exports = (db) => {

  async function recalcProject(projectId) {
    const row = await db.get('SELECT AVG(progress) as avg FROM tasks WHERE project_id=$1', [projectId]);
    const p   = Math.round(parseFloat(row?.avg) || 0);
    const status = p === 100 ? 'Concluído' : null;
    if (status) await db.run('UPDATE projects SET progress=$1,status=$2 WHERE id=$3', [p, status, projectId]);
    else        await db.run('UPDATE projects SET progress=$1 WHERE id=$2', [p, projectId]);
  }

  /* ── LIST ────────────────────────────────────────────────── */
  router.get('/', authenticate, async (req, res) => {
    try {
      const { project_id } = req.query;
      let sql = `SELECT t.*, u.name as assignee_name, p.name as project_name, p.code as project_code, p.area as project_area
        FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN projects p ON p.id=t.project_id WHERE 1=1`;
      const params = []; let i = 1;

      if (req.user.role !== 'admin' && req.user.role !== 'gestor-geral') {
        let depts = [];
        try { depts = Array.isArray(req.user.departments) ? req.user.departments : JSON.parse(req.user.departments || '[]'); } catch {}
        if (depts.length > 1) {
          const phs = depts.map((_, di) => '$' + (i + di)).join(',');
          sql += ` AND p.area IN (${phs})`;
          depts.forEach(d => params.push(d));
          i += depts.length;
        } else {
          const dept = req.user.active_department || (depts[0] || null);
          if (dept) { sql += ` AND p.area=$${i++}`; params.push(dept); }
        }
      }
      if (project_id) { sql += ` AND t.project_id=$${i++}`; params.push(project_id); }
      sql += ' ORDER BY t.project_id, t.eap_level, t.start_date NULLS LAST';
      res.json(await db.all(sql, params));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── GET ONE ─────────────────────────────────────────────── */
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const t = await db.get('SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=$1', [req.params.id]);
      if (!t) return res.status(404).json({ error: 'Não encontrado' });
      res.json(t);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── CREATE ──────────────────────────────────────────────── */
  router.post('/', authenticate,
    body('project_id').isInt(), body('name').notEmpty().trim(),
    async (req, res) => {
      try {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
        const f = req.body;
        if (!await db.get('SELECT id FROM projects WHERE id=$1', [f.project_id]))
          return res.status(404).json({ error: 'Projeto não encontrado' });
        const id = await db.run(
          `INSERT INTO tasks (project_id,name,description,start_date,end_date,progress,status,assignee_id,depends_on,milestone,eap_level,eap_code,baseline_start,baseline_end,budget,actual_cost,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [f.project_id,f.name,f.description||null,f.start_date||null,f.end_date||null,
           parseFloat(f.progress)||0,f.status||'Planejado',f.assignee_id||null,f.depends_on||null,
           f.milestone?true:false,parseInt(f.eap_level)||1,f.eap_code||null,
           f.start_date||null,f.end_date||null,
           parseFloat(f.budget)||0, parseFloat(f.actual_cost)||0, f.notes||null]
        );
        await recalcProject(f.project_id);
        res.status(201).json({ id, message: 'Tarefa criada' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

  /* ── UPDATE ──────────────────────────────────────────────── */
  router.put('/:id', authenticate, async (req, res) => {
    try {
      const t = await db.get('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
      if (!t) return res.status(404).json({ error: 'Não encontrado' });
      const fields = ['name','description','start_date','end_date','progress','status','assignee_id','depends_on','milestone','eap_level','eap_code','notes','budget','actual_cost'];
      const sets = []; const params = []; let i = 1;
      fields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); params.push(req.body[f]); } });
      if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
      params.push(req.params.id);
      await db.run(`UPDATE tasks SET ${sets.join(',')} WHERE id=$${i}`, params);
      await recalcProject(t.project_id);
      await audit(db, { userId: req.user.id, userName: req.user.name, action: 'UPDATE', entity: 'task', entityId: t.id, entityName: t.name, ip: req.ip });
      res.json({ message: 'Tarefa atualizada' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── PATCH PROGRESS (inline) ─────────────────────────────── */
  router.patch('/:id/progress', authenticate, async (req, res) => {
    try {
      const { progress, notes } = req.body;
      if (progress === undefined) return res.status(400).json({ error: 'progress obrigatório' });
      const t = await db.get('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
      if (!t) return res.status(404).json({ error: 'Não encontrado' });
      const p = Math.min(100, Math.max(0, parseFloat(progress)));
      const newStatus = p === 100 ? 'Concluído' : p > 0 ? 'Em andamento' : t.status;
      await db.run('UPDATE tasks SET progress=$1,status=$2' + (notes ? ',notes=$3 WHERE id=$4' : ' WHERE id=$3'),
        notes ? [p, newStatus, notes, req.params.id] : [p, newStatus, req.params.id]);
      await recalcProject(t.project_id);
      res.json({ progress: p, status: newStatus });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── DELETE ──────────────────────────────────────────────── */
  router.delete('/:id', authenticate, async (req, res) => {
    try {
      const t = await db.get('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
      if (!t) return res.status(404).json({ error: 'Não encontrado' });
      await db.run('DELETE FROM tasks WHERE id=$1', [req.params.id]);
      await recalcProject(t.project_id);
      res.json({ message: 'Tarefa removida' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });


  /* ── TASK UPDATES — listar ───────────────────────────────── */
  router.get('/:id/updates', authenticate, async (req, res) => {
    try {
      const rows = await db.all(
        `SELECT tu.*, u.name as user_name
         FROM task_updates tu
         LEFT JOIN users u ON u.id = tu.user_id
         WHERE tu.task_id = $1
         ORDER BY tu.week_ref DESC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── TASK UPDATES — criar ────────────────────────────────── */
  router.post('/:id/updates', authenticate, async (req, res) => {
    try {
      const task = await db.get('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
      if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });

      const { week_ref, progress, executed, blockers, next_steps } = req.body;
      if (!executed || !executed.trim())
        return res.status(400).json({ error: 'O campo "O que foi executado" é obrigatório' });

      const id = await db.run(
        `INSERT INTO task_updates (task_id, project_id, user_id, week_ref, progress, executed, blockers, next_steps)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          task.id,
          task.project_id,
          req.user.id,
          week_ref || new Date().toISOString().slice(0, 10),
          progress != null ? parseFloat(progress) : null,
          executed.trim(),
          blockers?.trim() || null,
          next_steps?.trim() || null,
        ]
      );

      // Se veio progresso, atualiza a tarefa também
      if (progress != null) {
        const p = Math.min(100, Math.max(0, parseFloat(progress)));
        const newStatus = p === 100 ? 'Concluído' : p > 0 ? 'Em andamento' : task.status;
        await db.run('UPDATE tasks SET progress=$1, status=$2 WHERE id=$3', [p, newStatus, task.id]);
        await recalcProject(task.project_id);
      }

      res.status(201).json({ id, message: 'Update registrado com sucesso' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── TASK UPDATES — deletar ──────────────────────────────── */
  router.delete('/:id/updates/:updateId', authenticate, async (req, res) => {
    try {
      await db.run('DELETE FROM task_updates WHERE id=$1 AND task_id=$2', [req.params.updateId, req.params.id]);
      res.json({ message: 'Update removido' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
