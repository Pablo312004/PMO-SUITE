const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

module.exports = (db) => {

  router.get('/', authenticate, async (req, res) => {
    try {
      const rows = await db.all(`SELECT r.*, 
        (SELECT COUNT(*) FROM resource_projects rp WHERE rp.resource_id=r.id) as project_count
        FROM resources r ORDER BY r.name`);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/', authenticate, async (req, res) => {
    try {
      const { name, role, email, cost_month, availability } = req.body;
      if (!name) return res.status(400).json({ error: 'name obrigatório' });
      const id = await db.run(
        'INSERT INTO resources (name,role,email,cost_month,availability) VALUES ($1,$2,$3,$4,$5)',
        [name, role||null, email||null, parseFloat(cost_month)||0, parseFloat(availability)||100]
      );
      res.status(201).json({ id, message: 'Recurso criado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/:id', authenticate, async (req, res) => {
    try {
      const { name, role, email, cost_month, availability } = req.body;
      await db.run('UPDATE resources SET name=$1,role=$2,email=$3,cost_month=$4,availability=$5 WHERE id=$6',
        [name, role||null, email||null, parseFloat(cost_month)||0, parseFloat(availability)||100, req.params.id]);
      res.json({ message: 'Recurso atualizado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/:id', authenticate, async (req, res) => {
    try {
      await db.run('DELETE FROM resources WHERE id=$1', [req.params.id]);
      res.json({ message: 'Recurso removido' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/:id/allocate', authenticate, async (req, res) => {
    try {
      const { project_id, workload, start_date, end_date } = req.body;
      await db.run(
        `INSERT INTO resource_projects (resource_id,project_id,workload,start_date,end_date)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (resource_id,project_id) DO UPDATE SET workload=$3,start_date=$4,end_date=$5`,
        [req.params.id, project_id, parseFloat(workload)||100, start_date||null, end_date||null]
      );
      res.json({ message: 'Alocação salva' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
