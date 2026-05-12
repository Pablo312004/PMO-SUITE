/**
 * PMO Suite v5.0 — Server
 * Backend Node.js + Express + PostgreSQL (Supabase)
 */
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const http        = require('http');
const { initDb }  = require('./db/database');

const PORT = process.env.PORT || 3000;

async function start() {
  const db = await initDb();

  const app    = express();
  const server = http.createServer(app);

  /* ── MIDDLEWARES ─────────────────────────────────────────── */
  app.use(cors({ origin: '*', credentials: true })); // Render serve frontend e backend juntos
  app.use(compression());
  app.use(express.json({ limit: '20mb' }));
  app.use(morgan('dev'));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));

  /* ── WEBSOCKET (notificações em tempo real) ──────────────── */
  try {
    const WebSocket = require('ws');
    const wss     = new WebSocket.Server({ server });
    const clients = new Map();
    app.locals.broadcast = (userId, payload) => {
      clients.get(Number(userId))?.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      });
    };
    wss.on('connection', (ws, req) => {
      const token = new URLSearchParams(req.url?.split('?')[1]).get('token');
      if (!token) return ws.close();
      try {
        const jwt        = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'pmo_secret_2025_change_in_prod';
        const user       = jwt.verify(token, JWT_SECRET);
        if (!clients.has(user.id)) clients.set(user.id, new Set());
        clients.get(user.id).add(ws);
        ws.on('close', () => { clients.get(user.id)?.delete(ws); });
      } catch { ws.close(); }
    });
    console.log('✅ WebSocket iniciado');
  } catch { console.log('⚠️  WebSocket não disponível'); }

  /* ── ROTAS ───────────────────────────────────────────────── */
  app.use('/api/auth',      require('./routes/auth')(db));
  app.use('/api/projects',  require('./routes/projects')(db));
  app.use('/api/tasks',     require('./routes/tasks')(db));
  app.use('/api/risks',     require('./routes/risks')(db));
  app.use('/api/resources', require('./routes/resources')(db));
  app.use('/api/dashboard', require('./routes/dashboard')(db));

  /* ── ALERT SCHEDULER ─────────────────────────────────────── */
  try {
    require('./services/alerts').startScheduler(db);
  } catch {}

  /* ── STATIC FRONTEND ─────────────────────────────────────── */
  const frontendPath = path.join(__dirname, '..', 'frontend');
  const fs = require('fs');

  // Serve index.html com meta tags injetadas pelo servidor (sem expor credenciais no HTML estático)
  app.get('/', (req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html
      .replace('{{SUPABASE_URL}}',      process.env.SUPABASE_URL      || '')
      .replace('{{SUPABASE_ANON_KEY}}', process.env.SUPABASE_ANON_KEY || '');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html
      .replace('{{SUPABASE_URL}}',      process.env.SUPABASE_URL      || '')
      .replace('{{SUPABASE_ANON_KEY}}', process.env.SUPABASE_ANON_KEY || '');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  /* ── START ───────────────────────────────────────────────── */
  server.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log(`║  🌿 PMO Suite v5.0 — porta ${PORT}               ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  http://localhost:${PORT}                        ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Banco: PostgreSQL / Supabase                ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  });
}

start().catch(e => { console.error('❌ Erro ao iniciar:', e.message); process.exit(1); });
