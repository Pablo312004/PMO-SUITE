const router = require('express').Router();
const { authenticate, audit } = require('../middleware/auth');

module.exports = (db) => {

  router.get('/', authenticate, async (req, res) => {
    try {
      const { project_id } = req.query;
      let sql = `SELECT r.*, u.name as owner_name, p.name as project_name, p.area,
        (r.probability*r.impact) as severity
        FROM risks r LEFT JOIN users u ON u.id=r.owner_id LEFT JOIN projects p ON p.id=r.project_id WHERE 1=1`;
      const params = []; let i = 1;
      if (req.user.role !== 'admin' && req.user.role !== 'gestor-geral') {
        let depts = [];
        try { depts = Array.isArray(req.user.departments) ? req.user.departments : JSON.parse(req.user.departments || '[]'); } catch {}
        if (depts.length > 1) {
          const placeholders = depts.map((_, di) => '$' + (i + di)).join(',');
          sql += ` AND p.area IN (${placeholders})`;
          depts.forEach(d => params.push(d));
          i += depts.length;
        } else {
          const dept = req.user.active_department || (depts[0] || null);
          if (dept) { sql += ` AND p.area=$${i++}`; params.push(dept); }
        }
      }
      if (project_id) { sql += ` AND r.project_id=$${i++}`; params.push(project_id); }
      sql += ' ORDER BY severity DESC';
      res.json(await db.all(sql, params));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/', authenticate, async (req, res) => {
    try {
      const { project_id, description, probability, impact, mitigation, contingency, owner_id, status, action_plan, deadline } = req.body;
      if (!project_id || !description) return res.status(400).json({ error: 'project_id e description obrigatórios' });
      const count = await db.get('SELECT COUNT(*) as n FROM risks WHERE project_id=$1', [project_id]);
      const code  = `R${String(parseInt(count?.n||0)+1).padStart(3,'0')}`;
      const id = await db.run(
        'INSERT INTO risks (project_id,code,description,probability,impact,mitigation,contingency,owner_id,status,action_plan,deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [project_id, code, description, probability||3, impact||3, mitigation||null, contingency||null, owner_id||null, status||'Identificado', action_plan||null, deadline||null]
      );
      await audit(db, { userId: req.user.id, userName: req.user.name, action: 'CREATE', entity: 'risk', entityId: id, entityName: description.slice(0,50), ip: req.ip });
      res.status(201).json({ id, code, message: 'Risco cadastrado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/:id', authenticate, async (req, res) => {
    try {
      const r = await db.get('SELECT * FROM risks WHERE id=$1', [req.params.id]);
      if (!r) return res.status(404).json({ error: 'Não encontrado' });
      const fields = ['description','probability','impact','mitigation','contingency','owner_id','status','action_plan','deadline'];
      const sets = []; const params = []; let i = 1;
      fields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); params.push(req.body[f]); } });
      if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
      params.push(req.params.id);
      await db.run(`UPDATE risks SET ${sets.join(',')} WHERE id=$${i}`, params);
      res.json({ message: 'Risco atualizado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/:id', authenticate, async (req, res) => {
    try {
      await db.run('DELETE FROM risks WHERE id=$1', [req.params.id]);
      res.json({ message: 'Risco removido' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
