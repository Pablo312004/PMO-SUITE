const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { authenticate, requireAdmin, audit, notify } = require('../middleware/auth');

module.exports = (db) => {

  /* ── LIST ────────────────────────────────────────────────── */
  router.get('/', authenticate, async (req, res) => {
    try {
      const { status, priority, area, search, period_start, period_end } = req.query;
      let sql = `SELECT p.*, COALESCE(u.name, p.manager_name_text) as manager_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) as task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='Concluído') as tasks_done,
        (SELECT COUNT(*) FROM risks r WHERE r.project_id=p.id AND r.status='Ativo') as active_risks
        FROM projects p LEFT JOIN users u ON u.id=p.manager_id WHERE 1=1`;
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
      if (status)       { sql += ` AND p.status=$${i++}`;                          params.push(status); }
      if (priority)     { sql += ` AND p.priority=$${i++}`;                        params.push(priority); }
      if (area && (req.user.role === 'admin' || req.user.role === 'gestor-geral'))
                        { sql += ` AND p.area=$${i++}`;                            params.push(area); }
      if (search)       { sql += ` AND (p.name ILIKE $${i} OR p.code ILIKE $${i+1})`; params.push(`%${search}%`,`%${search}%`); i+=2; }
      if (period_start) { sql += ` AND (p.end_date IS NULL OR p.end_date>=$${i++})`; params.push(period_start); }
      if (period_end)   { sql += ` AND (p.start_date IS NULL OR p.start_date<=$${i++})`; params.push(period_end); }
      sql += " ORDER BY CASE p.status WHEN 'Atrasado' THEN 0 WHEN 'Em andamento' THEN 1 ELSE 2 END, p.created_at DESC";
      res.json(await db.all(sql, params));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── FIND BY CODE (sem filtro dept — para importação) ───── */
  router.get('/by-code/:code', authenticate, async (req, res) => {
    try {
      const p = await db.get('SELECT id,code,name,area FROM projects WHERE code=$1', [req.params.code]);
      res.json(p || null);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── GET ONE ─────────────────────────────────────────────── */
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const p = await db.get(
        `SELECT p.*,
          COALESCE(u.name, p.manager_name_text) as manager_name
         FROM projects p
         LEFT JOIN users u ON u.id = p.manager_id
         WHERE p.id = $1`,
        [req.params.id]
      );
      if (!p) return res.status(404).json({ error: 'Projeto não encontrado' });
      const [tasks, risks, resources, updates, costs, changes] = await Promise.all([
        db.all('SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=$1 ORDER BY t.eap_level,t.start_date NULLS LAST', [p.id]),
        db.all('SELECT r.*, u.name as owner_name,(r.probability*r.impact) as severity FROM risks r LEFT JOIN users u ON u.id=r.owner_id WHERE r.project_id=$1 ORDER BY severity DESC', [p.id]),
        db.all('SELECT res.*, rp.workload FROM resource_projects rp JOIN resources res ON res.id=rp.resource_id WHERE rp.project_id=$1', [p.id]),
        db.all('SELECT w.*, u.name as user_name FROM weekly_updates w LEFT JOIN users u ON u.id=w.user_id WHERE w.project_id=$1 ORDER BY w.week DESC LIMIT 12', [p.id]),
        db.all('SELECT * FROM cost_entries WHERE project_id=$1 ORDER BY date DESC', [p.id]),
        db.all('SELECT cr.*, u.name as requester_name FROM change_requests cr LEFT JOIN users u ON u.id=cr.requester_id WHERE cr.project_id=$1 ORDER BY cr.created_at DESC', [p.id]),
      ]);
      Object.assign(p, { tasks, risks, resources, updates, costs, changes });
      res.json(p);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── KPIs ────────────────────────────────────────────────── */
  router.get('/:id/kpis', authenticate, async (req, res) => {
    try {
      const p = await db.get('SELECT * FROM projects WHERE id=$1', [req.params.id]);
      if (!p) return res.status(404).json({ error: 'Não encontrado' });
      const today = new Date();
      const start = p.start_date ? new Date(p.start_date) : today;
      const end   = p.end_date   ? new Date(p.end_date)   : today;
      const totalDays   = Math.max(1, (end - start) / 86400000);
      const elapsedDays = Math.min(Math.max(0, (today - start) / 86400000), totalDays);
      const plannedPct  = (elapsedDays / totalDays) * 100;
      const EV = (parseFloat(p.progress) / 100) * parseFloat(p.budget);
      const PV = (plannedPct / 100) * parseFloat(p.budget);
      const AC = parseFloat(p.actual_cost);
      const SPI = PV > 0 ? +(EV/PV).toFixed(2) : 1;
      const CPI = AC > 0 ? +(EV/AC).toFixed(2) : 1;
      const { n: risks } = await db.get("SELECT COUNT(*) as n FROM risks WHERE project_id=$1 AND status='Ativo'", [p.id]) || { n: 0 };
      const health = Math.min(100, Math.round(
        Math.min(SPI * 100, 100) * 0.30 +
        Math.min(CPI * 100, 100) * 0.25 +
        parseFloat(p.progress) * 0.20 +
        Math.max(0, 100 - parseInt(n || risks) * 15) * 0.15 + 10
      ));
      const bEnd   = p.baseline_end    ? new Date(p.baseline_end)    : null;
      const schedDev = bEnd && p.end_date ? Math.round((new Date(p.end_date) - bEnd) / 86400000) : 0;
      const budgDev  = p.baseline_budget > 0 ? +(((p.budget - p.baseline_budget) / p.baseline_budget) * 100).toFixed(1) : 0;

      // Tarefas vencendo em 7 dias
      const expiring = await db.all(
        "SELECT name, end_date FROM tasks WHERE project_id=$1 AND end_date BETWEEN NOW() AND NOW()+INTERVAL '7 days' AND status!='Concluído'",
        [p.id]
      );

      res.json({
        EV: Math.round(EV), PV: Math.round(PV), AC: Math.round(AC),
        SPI, CPI, CV: Math.round(EV - AC), SV: Math.round(EV - PV),
        plannedProgress: +plannedPct.toFixed(1), actualProgress: parseFloat(p.progress),
        healthScore: health, budget: parseFloat(p.budget), actualCost: parseFloat(p.actual_cost),
        scheduleDeviation: schedDev, budgetDeviationPct: budgDev,
        expiringTasks: expiring,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── CREATE ──────────────────────────────────────────────── */
  router.post('/', authenticate,
    body('name').notEmpty().trim(), body('code').notEmpty().trim(),
    async (req, res) => {
      try {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
        if (await db.get('SELECT id FROM projects WHERE code=$1', [req.body.code]))
          return res.status(409).json({ error: 'Código já existe' });
        const f = req.body;
        const id = await db.run(
          `INSERT INTO projects (code,name,description,area,manager_id,manager_name_text,start_date,end_date,status,priority,budget,actual_cost,progress,complexity,strategic_impact,objective,scope_in,scope_out,success_criteria,baseline_start,baseline_end,baseline_budget,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [f.code,f.name,f.description||null,f.area||null,f.manager_id||null,f.manager_name_text||null,
           f.start_date||null,f.end_date||null,
           f.status||'Planejado',f.priority||'Média',parseFloat(f.budget)||0,parseFloat(f.actual_cost)||0,
           parseFloat(f.progress)||0,f.complexity||'Média',f.strategic_impact||'Médio',
           f.objective||null,f.scope_in||null,f.scope_out||null,f.success_criteria||null,
           f.start_date||null,f.end_date||null,parseFloat(f.budget)||0,req.user.id]
        );
        await audit(db, { userId: req.user.id, userName: req.user.name, action: 'CREATE', entity: 'project', entityId: id, entityName: f.name, ip: req.ip });
        res.status(201).json({ id, message: 'Projeto criado' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

  /* ── UPDATE ──────────────────────────────────────────────── */
  router.put('/:id', authenticate, async (req, res) => {
    try {
      const p = await db.get('SELECT * FROM projects WHERE id=$1', [req.params.id]);
      if (!p) return res.status(404).json({ error: 'Não encontrado' });
      const fields = ['name','description','area','manager_id','start_date','end_date','status','priority','budget','actual_cost','progress','complexity','strategic_impact','objective','scope_in','scope_out','success_criteria'];
      const sets = []; const params = []; let i = 1;
      fields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); params.push(req.body[f]); } });
      if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
      params.push(req.params.id);
      await db.run(`UPDATE projects SET ${sets.join(',')} WHERE id=$${i}`, params);
      if (req.body.progress == 100) await db.run("UPDATE projects SET status='Concluído' WHERE id=$1", [req.params.id]);
      await audit(db, { userId: req.user.id, userName: req.user.name, action: 'UPDATE', entity: 'project', entityId: p.id, entityName: p.name, ip: req.ip });
      res.json({ message: 'Projeto atualizado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── PATCH PROGRESS ──────────────────────────────────────── */
  router.patch('/:id/progress', authenticate, async (req, res) => {
    try {
      const { progress } = req.body;
      if (progress === undefined || progress < 0 || progress > 100)
        return res.status(400).json({ error: 'Progresso inválido (0-100)' });
      const p = await db.get('SELECT * FROM projects WHERE id=$1', [req.params.id]);
      if (!p) return res.status(404).json({ error: 'Não encontrado' });
      const newStatus = progress == 100 ? 'Concluído' : p.status === 'Concluído' ? 'Em andamento' : p.status;
      await db.run('UPDATE projects SET progress=$1,status=$2 WHERE id=$3', [progress, newStatus, req.params.id]);
      await audit(db, { userId: req.user.id, userName: req.user.name, action: 'PROGRESS', entity: 'project', entityId: p.id, entityName: p.name, oldValue: p.progress, newValue: progress, ip: req.ip });
      res.json({ progress, status: newStatus, message: 'Progresso atualizado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── DELETE ──────────────────────────────────────────────── */
  router.delete('/:id', authenticate, async (req, res) => {
    try {
      const p = await db.get('SELECT * FROM projects WHERE id=$1', [req.params.id]);
      if (!p) return res.status(404).json({ error: 'Não encontrado' });
      await db.run('DELETE FROM projects WHERE id=$1', [req.params.id]);
      await audit(db, { userId: req.user.id, userName: req.user.name, action: 'DELETE', entity: 'project', entityId: p.id, entityName: p.name, ip: req.ip });
      res.json({ message: 'Projeto removido' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── BASELINE ────────────────────────────────────────────── */
  router.post('/:id/baseline', authenticate, async (req, res) => {
    try {
      const p = await db.get('SELECT * FROM projects WHERE id=$1', [req.params.id]);
      if (!p) return res.status(404).json({ error: 'Não encontrado' });
      await db.run(`UPDATE projects SET
        baseline_start=COALESCE(NULLIF(baseline_start::text,''),start_date::text)::date,
        baseline_end=COALESCE(NULLIF(baseline_end::text,''),end_date::text)::date,
        baseline_budget=CASE WHEN baseline_budget=0 THEN budget ELSE baseline_budget END
        WHERE id=$1`, [req.params.id]);
      await db.run(`UPDATE tasks SET
        baseline_start=COALESCE(NULLIF(baseline_start::text,''),start_date::text)::date,
        baseline_end=COALESCE(NULLIF(baseline_end::text,''),end_date::text)::date
        WHERE project_id=$1`, [req.params.id]);
      await audit(db, { userId: req.user.id, userName: req.user.name, action: 'BASELINE', entity: 'project', entityId: p.id, entityName: p.name, ip: req.ip });
      res.json({ message: 'Baseline salvo' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── WEEKLY UPDATE (registro semanal) ────────────────────── */
  router.post('/:id/weekly-update', authenticate,
    body('comment').notEmpty().trim(),
    async (req, res) => {
      try {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
        const p = await db.get('SELECT id FROM projects WHERE id=$1', [req.params.id]);
        if (!p) return res.status(404).json({ error: 'Não encontrado' });
        const week = new Date().toISOString().slice(0, 10); // YYYY-MM-DD da segunda
        const { comment, highlights, blockers, next_steps, progress, planned, status } = req.body;
        const id = await db.run(
          `INSERT INTO weekly_updates (project_id,user_id,week,progress,planned,comment,highlights,blockers,next_steps,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [req.params.id, req.user.id, week,
           progress||null, planned||null, comment,
           highlights||null, blockers||null, next_steps||null, status||null]
        );
        res.status(201).json({ id, message: 'Update semanal registrado' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

  /* ── COST ENTRY ──────────────────────────────────────────── */
  router.post('/:id/costs', authenticate, async (req, res) => {
    try {
      const { date, amount, category, description } = req.body;
      if (!date || !amount) return res.status(400).json({ error: 'date e amount obrigatórios' });
      const id = await db.run(
        'INSERT INTO cost_entries (project_id,date,amount,category,description,created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id, date, parseFloat(amount), category||null, description||null, req.user.id]
      );
      // Recalcular actual_cost
      const { total } = await db.get('SELECT SUM(amount) as total FROM cost_entries WHERE project_id=$1', [req.params.id]) || { total: 0 };
      await db.run('UPDATE projects SET actual_cost=$1 WHERE id=$2', [parseFloat(total)||0, req.params.id]);
      res.status(201).json({ id, message: 'Custo registrado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── CHANGE REQUEST ──────────────────────────────────────── */
  router.post('/:id/change-requests', authenticate, async (req, res) => {
    try {
      const { type, description, old_value, new_value, justification } = req.body;
      if (!type || !description) return res.status(400).json({ error: 'type e description obrigatórios' });
      const id = await db.run(
        'INSERT INTO change_requests (project_id,requester_id,type,description,old_value,new_value,justification) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.params.id, req.user.id, type, description, old_value||null, new_value||null, justification||null]
      );
      // Notificar admin
      const admins = await db.all("SELECT id FROM users WHERE role='admin' AND is_active=TRUE");
      for (const a of admins) {
        await notify(db, { userId: a.id, type: 'change_request', title: 'Nova solicitação de mudança', message: description });
      }
      res.status(201).json({ id, message: 'Solicitação registrada' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/:id/change-requests/:crId', authenticate, async (req, res) => {
    try {
      const { status, review_note } = req.body;
      await db.run('UPDATE change_requests SET status=$1,review_note=$2,reviewer_id=$3,reviewed_at=NOW() WHERE id=$4',
        [status, review_note||null, req.user.id, req.params.crId]);
      res.json({ message: 'Solicitação atualizada' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
