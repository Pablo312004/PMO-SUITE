/* PMO Suite v4.0 — Core utilities */
const API = '/api';

// ── Auth store ───────────────────────────────────────────────────────────
const Auth = {
  get token()   { return localStorage.getItem('pmo_token'); },
  get refresh() { return localStorage.getItem('pmo_refresh'); },
  get user()    { try { return JSON.parse(localStorage.getItem('pmo_user')||'null'); } catch { return null; } },
  set(token, user, refresh) {
    localStorage.setItem('pmo_token', token);
    localStorage.setItem('pmo_user', JSON.stringify(user));
    if (refresh) localStorage.setItem('pmo_refresh', refresh);
  },
  clear() { ['pmo_token','pmo_refresh','pmo_user'].forEach(k => localStorage.removeItem(k)); },
  get isAdmin()     { return this.user?.role === 'admin'; },
  get isGestorGeral() { return this.user?.role === 'gestor-geral'; },
  get departments() { return this.user?.departments || []; },
  get activeDept()  { return this.user?.active_department || this.departments[0] || null; },
  // Precisa mostrar seletor de dept? Sim se tem 2+ depts e não é admin
  get needsDeptSwitch() {
    const u = this.user;
    if (!u) return false;
    if (u.role === 'admin') return false;
    return (u.departments || []).length > 1;
  },
};

// ── HTTP with auto-refresh ───────────────────────────────────────────────
let _refreshing = false, _queue = [];

async function _fetch(method, path, body) {
  const opts = { method, headers: { 'Content-Type':'application/json', ...(Auth.token ? { Authorization:'Bearer '+Auth.token } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(API + path, opts);
}

async function api(method, path, body = null) {
  let res = await _fetch(method, path, body);

  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data.code === 'TOKEN_EXPIRED' && Auth.refresh) {
      if (_refreshing) return new Promise((ok,err) => _queue.push({ok,err,method,path,body}));
      _refreshing = true;
      try {
        const r = await fetch(API+'/auth/refresh', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ refreshToken: Auth.refresh }) });
        const d = await r.json();
        if (!r.ok) throw new Error('refresh failed');
        Auth.set(d.accessToken||d.token, Auth.user, d.refreshToken);
        _refreshing = false;
        _queue.forEach(q => api(q.method,q.path,q.body).then(q.ok).catch(q.err));
        _queue = [];
        res = await _fetch(method, path, body);
      } catch {
        _refreshing = false; _queue.forEach(q => q.err(new Error('Session expired'))); _queue = [];
        Auth.clear(); showAuth(); toast('Sessão expirada. Faça login.','error'); return;
      }
    } else {
      Auth.clear(); showAuth(); toast('Sessão inválida.','error'); return;
    }
  }

  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || result.message || 'HTTP '+res.status);
  return result;
}

const GET    = (p)      => api('GET',    p);
const POST   = (p,b)    => api('POST',   p, b);
const PUT    = (p,b)    => api('PUT',    p, b);
const PATCH  = (p,b)    => api('PATCH',  p, b);
const DELETE = (p)      => api('DELETE', p);

// ── Toast ────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3500);
}

// ── Modals ───────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ── Badges / formatters ──────────────────────────────────────────────────
function statusBadge(s) {
  const m = {'Em andamento':'blue','Concluído':'green','Atrasado':'red','Planejado':'neutral',
    'Em Risco':'yellow','Ativo':'red','Monitorando':'yellow','Identificado':'blue','Encerrado':'green',
    'Pendente':'yellow','Aprovado':'green','Rejeitado':'red','Em espera':'yellow'};
  return `<span class="badge badge-${m[s]||'neutral'}">${s||'—'}</span>`;
}

function priorityBadge(p) {
  const m = {'Alta':'alta','Média':'media','Baixa':'baixa'};
  return `<span class="priority-${m[p]||'media'}">${p||'—'}</span>`;
}

function progressEl(pct, editable = false, projectId = null) {
  const n = Math.round(pct || 0);
  const c = n >= 70 ? 'green' : n >= 40 ? 'yellow' : 'red';
  if (editable && projectId) {
    return `<div class="progress-inline">
      <input type="range" min="0" max="100" value="${n}" oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="inlineProgress(${projectId},this.value,this)">
      <span>${n}%</span>
    </div>`;
  }
  return `<div class="progress-wrap"><div class="progress-pct">${n}%</div>
    <div class="progress-bar"><div class="progress-fill pf-${c}" style="width:${n}%"></div></div></div>`;
}

function healthBadge(score) {
  const color = score >= 80 ? '#2E7D32' : score >= 60 ? '#E65100' : '#C62828';
  const label = score >= 80 ? 'Saudável' : score >= 60 ? 'Alerta' : 'Crítico';
  return `<div class="health-badge" style="border-color:${color};color:${color}" title="${label} — ${score}/100"><span style="font-size:11px;font-weight:700">${score}</span></div>`;
}

function riskBadge(sev) {
  if (sev >= 20) return `<span class="badge badge-red">Crítico (${sev})</span>`;
  if (sev >= 12) return `<span class="badge badge-red">Alto (${sev})</span>`;
  if (sev >= 6)  return `<span class="badge badge-yellow">Médio (${sev})</span>`;
  return `<span class="badge badge-green">Baixo (${sev})</span>`;
}

function fmtCurrency(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1000000) return `R$ ${(n/1000000).toFixed(1)}M`;
  if (n >= 1000)    return `R$ ${Math.round(n/1000)}k`;
  return `R$ ${n.toFixed(0)}`;
}

function fmtDate(d) {
  if (!d) return '—';
  // Remove timestamp do PostgreSQL se existir (ex: "2026-03-30 00:00:00")
  const s = String(d).replace(' ', 'T').split('T')[0];
  // Valida formato YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  // Usa T12:00:00 para evitar problemas de fuso horário
  return new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', {day:'2-digit', month:'short', year:'2-digit'});
}

function fmtPct(n) { return Math.round(n||0)+'%'; }

// ── Inline progress update ───────────────────────────────────────────────
async function inlineProgress(id, value, el) {
  try {
    const res = await PATCH(`/projects/${id}/progress`, { progress: parseFloat(value) });
    toast(`Progresso atualizado: ${value}%`, 'success');
    // Update status badge in same row if it changed
    if (res?.status) {
      const row = el.closest('tr');
      const statusCell = row?.querySelector('.status-cell');
      if (statusCell) statusCell.innerHTML = statusBadge(res.status);
    }
    loadDashboard();
  } catch (e) { toast(e.message, 'error'); }
}

async function inlineTaskProgress(id, value) {
  try {
    await PATCH(`/tasks/${id}/progress`, { progress: parseFloat(value) });
  } catch (e) { toast(e.message, 'error'); }
}

// ── Navigation ───────────────────────────────────────────────────────────
let currentSection = 'dashboard';
const sectionLoaders = {};

function showSection(id, navEl) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('sec-'+id)?.classList.add('active');
  navEl?.classList.add('active');
  currentSection = id;
  document.getElementById('topbar-title').textContent = navEl?.querySelector('.nav-text')?.textContent || '';
  sectionLoaders[id]?.();
  closeSidebar();
}

// ── Mobile sidebar ───────────────────────────────────────────────────────
function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('open');
}

function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
}

// ── Notifications ────────────────────────────────────────────────────────
async function loadNotifBadge() {
  try {
    const d = await GET('/dashboard/notifications');
    const badge = document.getElementById('notif-badge');
    if (badge) { badge.textContent = d.unread||0; badge.style.display = d.unread>0 ? 'flex' : 'none'; }
  } catch {}
}

function toggleNotifPanel() {
  const p = document.getElementById('notif-panel');
  if (!p) return;
  const open = p.classList.toggle('open');
  if (open) { loadNotifPanel(); PUT('/dashboard/notifications/read-all').catch(()=>{}); setTimeout(loadNotifBadge,300); }
}

async function loadNotifPanel() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  try {
    const d = await GET('/dashboard/notifications');
    if (!d.notifications?.length) { list.innerHTML='<div class="empty-state" style="padding:20px">Nenhuma notificação</div>'; return; }
    const icons = { delay:'🚨', risk:'⚠️', project:'📁', change:'📋', calendar:'📅' };
    list.innerHTML = d.notifications.map(n => `
      <div class="notif-item ${n.read?'':'unread'}">
        <div class="notif-icon">${icons[n.type]||'ℹ️'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${n.title}</div>
          ${n.message?`<div style="font-size:12px;color:var(--text2);margin-top:2px">${n.message}</div>`:''}
          <div style="font-size:11px;color:var(--text3);margin-top:4px">${new Date(n.created_at).toLocaleString('pt-BR')}</div>
        </div>
        <button onclick="dismissNotif(${n.id},this)" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:2px">✕</button>
      </div>`).join('');
  } catch {}
}

async function dismissNotif(id, btn) {
  await DELETE('/dashboard/notifications/'+id).catch(()=>{});
  btn.closest('.notif-item')?.remove();
  loadNotifBadge();
}

async function markAllRead() {
  await PUT('/dashboard/notifications/read-all').catch(()=>{});
  loadNotifBadge(); loadNotifPanel();
}

// close notif panel on outside click
document.addEventListener('click', e => {
  const p = document.getElementById('notif-panel');
  const b = document.getElementById('notif-btn');
  if (p?.classList.contains('open') && !p.contains(e.target) && !b?.contains(e.target)) p.classList.remove('open');
  // close modals on overlay click
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ── Helper: populate select with users ──────────────────────────────────
async function loadUserSelect(id, selectedId = null) {
  try {
    const users = await GET('/auth/users');
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">— Selecionar —</option>' +
      users.map(u => `<option value="${u.id}" ${u.id==selectedId?'selected':''}>${u.name}</option>`).join('');
  } catch {}
}

async function loadProjectSelect(id, selectedId = null, placeholder = '— Todos os projetos —') {
  try {
    const projects = await GET('/projects');
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>` +
      projects.map(p => `<option value="${p.id}" ${p.id==selectedId?'selected':''}>${p.code} — ${p.name}</option>`).join('');
  } catch {}
}

function set$(id, val) { const el = document.getElementById(id); if (el) el.textContent = val??'—'; }

// ── Gantt helpers ────────────────────────────────────────────────────────
const GANTT_S = new Date('2025-01-01'), GANTT_E = new Date('2025-12-31');
const GANTT_D = (GANTT_E - GANTT_S) / 86400000;
function ganttPct(d) { if(!d) return 0; return Math.max(0,Math.min(100,(new Date(d+'T12:00:00')-GANTT_S)/86400000/GANTT_D*100)); }
function ganttBarCls(s) { return {'Concluído':'gb-green','Em andamento':'gb-blue','Atrasado':'gb-red','Planejado':'gb-gray','Em Risco':'gb-yellow'}[s]||'gb-gray'; }
