const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { authenticate, requireAdmin, signAccess, signRefresh, audit } = require('../middleware/auth');

module.exports = (db) => {

  /* ── LOGIN ───────────────────────────────────────────────── */
  router.post('/login',
    body('email').isEmail(), body('password').notEmpty(),
    async (req, res) => {
      try {
        const errs = validationResult(req);
        if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
        const { email, password } = req.body;
        const user = await db.get('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
        if (!user || !bcrypt.compareSync(password, user.password))
          return res.status(401).json({ error: 'Credenciais inválidas' });

        // Força troca de senha no primeiro acesso (senha ainda é Safra@2027 default)
        const isFirstAccess = !user.last_login;

        const accessToken  = signAccess(user);
        const refreshToken = signRefresh();
        const exp = new Date(); exp.setDate(exp.getDate() + 7);
        await db.run('INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,$3)', [user.id, refreshToken, exp.toISOString()]);
        await db.run('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
        await audit(db, { userId: user.id, userName: user.name, action: 'LOGIN', entity: 'user', entityId: user.id, ip: req.ip });

        let depts = [];
        if (Array.isArray(user.departments)) depts = user.departments;
        else if (typeof user.departments === 'string') { try { depts = JSON.parse(user.departments); } catch {} }
        const activeDept = user.active_department || depts[0] || null;
        res.json({ token: accessToken, accessToken, refreshToken, isFirstAccess,
          user: { id: user.id, name: user.name, email: user.email, role: user.role,
                  avatar_url: user.avatar_url, departments: depts, active_department: activeDept } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

  /* ── REFRESH TOKEN ───────────────────────────────────────── */
  router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ error: 'refreshToken obrigatório' });
      const stored = await db.get("SELECT * FROM refresh_tokens WHERE token=$1 AND expires_at>NOW()", [refreshToken]);
      if (!stored) return res.status(401).json({ error: 'Refresh token inválido', code: 'REFRESH_EXPIRED' });
      const user = await db.get('SELECT * FROM users WHERE id=$1 AND is_active=TRUE', [stored.user_id]);
      if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
      await db.run('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
      const newRefresh = signRefresh();
      const exp = new Date(); exp.setDate(exp.getDate() + 7);
      await db.run('INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,$3)', [user.id, newRefresh, exp.toISOString()]);
      const newAccess = signAccess(user);
      res.json({ token: newAccess, accessToken: newAccess, refreshToken: newRefresh });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── LOGOUT ──────────────────────────────────────────────── */
  router.post('/logout', authenticate, async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (refreshToken) await db.run('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
      await db.run("DELETE FROM refresh_tokens WHERE expires_at<NOW()");
      res.json({ message: 'Logout realizado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── TROCAR DEPARTAMENTO ─────────────────────────────────── */
  router.post('/switch-department', authenticate, async (req, res) => {
    try {
      const { department } = req.body;
      if (!department) return res.status(400).json({ error: 'department obrigatório' });
      const user = await db.get('SELECT * FROM users WHERE id=$1 AND is_active=TRUE', [req.user.id]);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
      let depts = [];
      if (Array.isArray(user.departments)) depts = user.departments;
      else if (typeof user.departments === 'string') { try { depts = JSON.parse(user.departments); } catch {} }
      const canSwitch = user.role === 'admin' || user.role === 'gestor-geral' || depts.includes(department);
      if (!canSwitch) return res.status(403).json({ error: 'Acesso negado a este departamento' });
      await db.run('UPDATE users SET active_department=$1 WHERE id=$2', [department, user.id]);
      const updated = await db.get('SELECT * FROM users WHERE id=$1', [user.id]);
      const accessToken  = signAccess(updated);
      const refreshToken = signRefresh();
      const exp = new Date(); exp.setDate(exp.getDate() + 7);
      await db.run('DELETE FROM refresh_tokens WHERE user_id=$1', [user.id]);
      await db.run('INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,$3)', [updated.id, refreshToken, exp.toISOString()]);
      let updatedDepts = [];
      if (Array.isArray(updated.departments)) updatedDepts = updated.departments;
      else if (typeof updated.departments === 'string') { try { updatedDepts = JSON.parse(updated.departments); } catch {} }
      res.json({ token: accessToken, accessToken, refreshToken,
        user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role,
                avatar_url: updated.avatar_url, departments: updatedDepts, active_department: department } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── ME ──────────────────────────────────────────────────── */
  router.get('/me', authenticate, async (req, res) => {
    try {
      const u = await db.get('SELECT id,name,email,role,avatar_url,last_login,created_at,departments,active_department FROM users WHERE id=$1', [req.user.id]);
      res.json(u);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/me', authenticate, body('name').notEmpty().trim().optional(), async (req, res) => {
    try {
      const { name } = req.body;
      if (name) await db.run('UPDATE users SET name=$1 WHERE id=$2', [name, req.user.id]);
      res.json({ message: 'Perfil atualizado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── CHANGE PASSWORD ─────────────────────────────────────── */
  router.put('/me/password', authenticate, async (req, res) => {
    try {
      const { current, newPassword } = req.body;
      if (!current || !newPassword || newPassword.length < 6)
        return res.status(400).json({ error: 'Senha atual e nova senha (mín. 6 chars) obrigatórias' });
      const user = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
      if (!bcrypt.compareSync(current, user.password))
        return res.status(400).json({ error: 'Senha atual incorreta' });
      await db.run('UPDATE users SET password=$1 WHERE id=$2', [bcrypt.hashSync(newPassword, 12), req.user.id]);
      await db.run('DELETE FROM refresh_tokens WHERE user_id=$1', [req.user.id]);
      await audit(db, { userId: user.id, userName: user.name, action: 'CHANGE_PASSWORD', entity: 'user', entityId: user.id, ip: req.ip });
      res.json({ message: 'Senha alterada com sucesso' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── USERS LIST (admin) ──────────────────────────────────── */
  router.get('/users', authenticate, async (req, res) => {
    try {
      const rows = await db.all('SELECT id,name,email,role,avatar_url,is_active,last_login,departments,active_department FROM users ORDER BY name');
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
    try {
      const { role, is_active, name } = req.body;
      const sets = []; const params = []; let i = 1;
      if (role !== undefined)      { sets.push(`role=$${i++}`);      params.push(role); }
      if (is_active !== undefined) { sets.push(`is_active=$${i++}`); params.push(is_active); }
      if (name)                    { sets.push(`name=$${i++}`);      params.push(name); }
      if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
      params.push(req.params.id);
      await db.run(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, params);
      res.json({ message: 'Usuário atualizado' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── LOGIN VIA GOOGLE (Supabase OAuth callback) ──────────── */
  router.post('/login-google', async (req, res) => {
    try {
      const { email, google_id, name, avatar_url } = req.body;
      if (!email) return res.status(400).json({ error: 'email obrigatório' });

      // Busca usuário pelo email cadastrado
      let user = await db.get('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
      if (!user) return res.status(403).json({ error: 'Email não cadastrado no sistema. Contacte o administrador.' });

      // Atualiza dados do Google se necessário
      if (google_id || avatar_url) {
        await db.run('UPDATE users SET google_id=$1, avatar_url=COALESCE($2,avatar_url), last_login=NOW() WHERE id=$3',
          [google_id || null, avatar_url || null, user.id]);
        user = await db.get('SELECT * FROM users WHERE id=$1', [user.id]);
      } else {
        await db.run('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
      }

      const isFirstAccess = !user.last_login;
      const accessToken  = signAccess(user);
      const refreshToken = signRefresh();
      const exp = new Date(); exp.setDate(exp.getDate() + 7);
      await db.run('INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,$3)', [user.id, refreshToken, exp.toISOString()]);
      await audit(db, { userId: user.id, userName: user.name, action: 'LOGIN_GOOGLE', entity: 'user', entityId: user.id, ip: req.ip });

      let depts = [];
      if (Array.isArray(user.departments)) depts = user.departments;
      else if (typeof user.departments === 'string') { try { depts = JSON.parse(user.departments); } catch {} }
      const activeDept = user.active_department || depts[0] || null;

      res.json({ token: accessToken, accessToken, refreshToken, isFirstAccess,
        user: { id: user.id, name: user.name, email: user.email, role: user.role,
                avatar_url: user.avatar_url, departments: depts, active_department: activeDept } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
