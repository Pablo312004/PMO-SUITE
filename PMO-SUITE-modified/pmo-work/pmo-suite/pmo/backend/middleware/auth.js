const jwt  = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET         = process.env.JWT_SECRET         || 'pmo_secret_2025_change_in_prod';
const JWT_EXPIRES_IN     = process.env.JWT_EXPIRES_IN     || '8h';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'pmo_refresh_secret_2025';

function signAccess(user) {
  // pg retorna JSONB já como array/objeto — não precisa de JSON.parse
  let depts = [];
  if (Array.isArray(user.departments)) depts = user.departments;
  else if (typeof user.departments === 'string') {
    try { depts = JSON.parse(user.departments); } catch { depts = []; }
  }
  return jwt.sign({
    id: user.id, email: user.email, name: user.name, role: user.role,
    departments: depts,
    active_department: user.active_department || depts[0] || null,
  }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function signRefresh() { return uuidv4() + '.' + Date.now().toString(36); }

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token não fornecido', code: 'NO_TOKEN' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch (e) {
    const code = e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    res.status(401).json({ error: code === 'TOKEN_EXPIRED' ? 'Token expirado' : 'Token inválido', code });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Requer perfil admin', code: 'FORBIDDEN' });
  next();
}

async function audit(db, { userId, userName, action, entity, entityId, entityName, oldValue, newValue, ip }) {
  try {
    await db.run('INSERT INTO audit_log (user_id,user_name,action,entity,entity_id,entity_name,old_value,new_value,ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [userId||null, userName||null, action, entity, entityId||null, entityName||null,
       oldValue!=null?String(oldValue):null, newValue!=null?String(newValue):null, ip||null]);
  } catch {}
}

async function notify(db, { userId, type, title, message, link }) {
  try { await db.run('INSERT INTO notifications (user_id,type,title,message,link) VALUES ($1,$2,$3,$4,$5)', [userId,type,title,message||null,link||null]); } catch {}
}

module.exports = { authenticate, requireAdmin, audit, notify, signAccess, signRefresh, JWT_SECRET };
