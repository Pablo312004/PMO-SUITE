/* PMO Suite v4.0 — Main app logic */

/* ═══════════════════════════ AUTH ═══════════════════════════════ */
function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  const u = Auth.user;
  if (u) {
    set$('user-name', u.name);
    // Mostra departamento ativo abaixo do nome (não para admin)
    const roleTextEl = document.getElementById('user-role-text');
    if (roleTextEl) {
      if (u.role === 'admin') roleTextEl.textContent = 'Administrador';
      else if (u.active_department) roleTextEl.textContent = '🏢 ' + u.active_department;
      else if (u.role === 'gestor-geral') roleTextEl.textContent = 'Gestor Geral';
      else roleTextEl.textContent = u.role;
    }
    const av = document.getElementById('user-avatar');
    if (av) {
      if (u.avatar_url) av.innerHTML = `<img src="${u.avatar_url}">`;
      else av.textContent = (u.name||'U').charAt(0).toUpperCase();
    }
    // Botão de troca de departamento (só para quem tem 2+ depts)
    const switchBtn = document.getElementById('dept-switch-btn');
    if (switchBtn) {
      if (Auth.needsDeptSwitch) {
        switchBtn.style.display = 'flex';
        switchBtn.title = 'Trocar departamento';
      } else {
        switchBtn.style.display = 'none';
      }
    }
  }
  loadDashboard();
  setTimeout(loadNotifBadge, 800);
}

// ── SUPABASE CLIENT (para OAuth Google) ──────────────────────
// As credenciais são injetadas pelo servidor via meta tags no HTML
const _supaUrl  = document.querySelector('meta[name="supa-url"]')?.content  || '';
const _supaKey  = document.querySelector('meta[name="supa-key"]')?.content  || '';
const _supa = (_supaUrl && _supaKey && window.supabase)
  ? window.supabase.createClient(_supaUrl, _supaKey)
  : null;

async function loginWithGoogle() {
  if (!_supa) { toast('Supabase não inicializado', 'error'); return; }
  const { error } = await _supa.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + '/?auth=google',
      queryParams: { access_type: 'offline', prompt: 'select_account' },
    }
  });
  if (error) toast('Erro Google: ' + error.message, 'error');
}

// Processa callback do Google OAuth (ao voltar do redirect)
async function _handleGoogleCallback() {
  if (!_supa) return;
  const { data: { session }, error } = await _supa.auth.getSession();
  if (error || !session) return;

  // Autentica com nosso backend usando o email do Google
  try {
    const email = session.user.email;
    // Busca usuário no nosso sistema pelo email
    const d = await POST('/auth/login-google', { 
      email,
      google_id:   session.user.id,
      name:        session.user.user_metadata?.full_name || session.user.email,
      avatar_url:  session.user.user_metadata?.avatar_url || null,
    });
    Auth.set(d.accessToken || d.token, d.user, d.refreshToken);
    // Limpa parâmetros da URL
    history.replaceState({}, '', '/');
    if (Auth.needsDeptSwitch && !Auth.activeDept) {
      showDeptSelector(d.user.departments);
    } else {
      showApp();
      toast('Bem-vindo, ' + d.user.name + '!', 'success');
    }
    if (d.isFirstAccess) setTimeout(showForcePasswordChange, 800);
  } catch(err) {
    toast('Conta Google não cadastrada no sistema. Contacte o administrador.', 'error');
    await _supa.auth.signOut();
  }
}

async function doLogin(e) {
  e.preventDefault();
  const btn    = document.getElementById('login-btn');
  const errBox = document.getElementById('login-error');
  if (errBox) errBox.style.display = 'none';
  btn.textContent = '⏳ Entrando…'; btn.disabled = true;
  try {
    const d = await POST('/auth/login', {
      email:    document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-pass').value,
    });
    Auth.set(d.accessToken || d.token, d.user, d.refreshToken);
    if (Auth.needsDeptSwitch && !Auth.activeDept) {
      showDeptSelector(d.user.departments);
    } else {
      showApp();
      toast('Bem-vindo, ' + d.user.name + '!', 'success');
    }
    if (d.isFirstAccess) setTimeout(showForcePasswordChange, 800);
  } catch(err) {
    // Mostra erro diretamente na tela (não some rápido)
    const msg = err.message || 'Erro ao conectar. Tente novamente.';
    if (errBox) { errBox.textContent = '❌ ' + msg; errBox.style.display = 'block'; }
    else toast(msg, 'error');
  } finally {
    btn.textContent = 'Entrar no Sistema'; btn.disabled = false;
  }
}

async function doLogout() {
  try { await POST('/auth/logout', { refreshToken: Auth.refresh }); } catch {}
  Auth.clear(); showAuth(); toast('Sessão encerrada', 'info');
}

// OAuth callback
(function handleCallback() {
  const p = new URLSearchParams(location.search);
  const token = p.get('token'), err = p.get('auth_error');
  if (token || err) history.replaceState({}, '', '/');
  if (err) { setTimeout(() => toast(decodeURIComponent(err), 'error'), 500); return; }
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      Auth.set(token, { id:payload.id, name:payload.name, email:payload.email, role:payload.role });
    } catch { Auth.set(token, { name:'Usuário' }); }
  }
})();

/* ═══════════════════════════ DASHBOARD ══════════════════════════ */
let charts = {};
function destroyChart(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }

function _renderExpiringPanel(expiring) {
  const el = document.getElementById('expiring-panel');
  const em = document.getElementById('expiring-empty');
  if (!el) return;
  if (!expiring || !expiring.length) {
    el.style.display = 'none';
    if (em) em.style.display = 'block';
    return;
  }
  if (em) em.style.display = 'none';
  el.style.display = 'block';
  el.innerHTML = expiring.map(t => {
    const days = t.end_date ? Math.ceil((new Date(t.end_date) - new Date()) / 86400000) : null;
    const color = days !== null && days <= 3 ? 'var(--danger)' : 'var(--warn)';
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + t.name + '</div>' +
        '<div style="font-size:11px;color:var(--text2)">' + (t.project_name || '') + ' · ' + (t.assignee_name || 'Sem responsável') + '</div>' +
      '</div>' +
      '<div style="white-space:nowrap;font-size:12px;font-weight:600;color:' + color + '">' + (t.end_date || '—') + '</div>' +
    '</div>';
  }).join('');
}

async function loadDashboard() {
  try {
    const area = document.getElementById('filter-area')?.value || '';
    const qs   = area ? '?area=' + encodeURIComponent(area) : '';

    // Novo endpoint unificado
    const d = await GET('/dashboard' + qs);
    const summary  = d.summary  || {};
    const byStatus = d.byStatus || [];
    const byArea   = d.byArea   || [];
    const critical = d.overdue  || [];
    const expiring = d.expiring || [];

    // Adapta estrutura para compatibilidade com a UI existente
    const byPrio  = [];
    const financial = [];
    const evolution = [];

    // KPIs — usa a nova estrutura flat do /dashboard
    set$('kpi-total',    summary.total_projects   || 0);
    set$('kpi-active',   summary.active           || 0);
    set$('kpi-done',     summary.done             || 0);
    set$('kpi-delayed',  summary.delayed          || 0);
    set$('kpi-progress', (summary.avg_progress    || 0)+'%');
    set$('kpi-budget',   fmtCurrency(parseFloat(summary.total_budget)  || 0));
    set$('kpi-actual',   fmtCurrency(parseFloat(summary.total_cost)    || 0));
    set$('kpi-risks',    0); // calculado nos detalhes

    // Topbar pill
    const pill = document.getElementById('status-pill');
    if (pill) {
      const delayed = summary.delayed || 0;
      pill.className = 'topbar-pill ' + (delayed > 0 ? 'red' : 'green');
      pill.textContent = delayed > 0 ? `${delayed} Atrasado${delayed>1?'s':''}` : 'Portfólio OK';
    }

    // Painel de vencimento (novidade v5)
    _renderExpiringPanel(expiring);

    // Chart defaults
    Chart.defaults.color = '#616161'; Chart.defaults.borderColor = '#E0E0E0';
    Chart.defaults.font.family = "'Inter',sans-serif"; Chart.defaults.font.size = 11;

    const STATUS_COLORS = {'Em andamento':'#1565C0','Concluído':'#2E7D32','Atrasado':'#C62828','Planejado':'#455A64','Em Risco':'#E65100'};

    destroyChart('status');
    const sCtx = document.getElementById('chart-status')?.getContext('2d');
    if (sCtx) charts.status = new Chart(sCtx, { type:'doughnut',
      data:{ labels:byStatus.map(r=>r.status), datasets:[{ data:byStatus.map(r=>r.count), backgroundColor:byStatus.map(r=>STATUS_COLORS[r.status]||'#9E9E9E'), borderWidth:0, hoverOffset:4 }] },
      options:{ plugins:{ legend:{ position:'bottom', labels:{ padding:12, boxWidth:10 } } }, cutout:'62%' } });

    destroyChart('priority');
    const pCtx = document.getElementById('chart-priority')?.getContext('2d');
    if (pCtx) charts.priority = new Chart(pCtx, { type:'doughnut',
      data:{ labels:byPrio.map(r=>r.priority), datasets:[{ data:byPrio.map(r=>r.count), backgroundColor:['#C62828','#E65100','#2E7D32'], borderWidth:0 }] },
      options:{ plugins:{ legend:{ position:'bottom', labels:{ padding:12, boxWidth:10 } } }, cutout:'55%' } });

    destroyChart('area');
    const aCtx = document.getElementById('chart-area')?.getContext('2d');
    if (aCtx) charts.area = new Chart(aCtx, { type:'bar',
      data:{ labels:byArea.map(r=>r.area),
        datasets:[
          { label:'Projetos', data:byArea.map(r=>r.count), backgroundColor:'rgba(46,125,50,.75)', borderRadius:4 },
          { label:'Progresso %', data:byArea.map(r=>r.avg_progress), backgroundColor:'rgba(21,101,192,.45)', borderRadius:4, yAxisID:'y2' }
        ] },
      options:{ plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10 } } },
        scales:{ x:{ grid:{ color:'#F5F5F5' } }, y:{ beginAtZero:true, grid:{ color:'#F5F5F5' } },
          y2:{ position:'right', beginAtZero:true, max:100, ticks:{ callback:v=>v+'%' }, grid:{ display:false } } } } });

    destroyChart('financial');
    const fCtx = document.getElementById('chart-financial')?.getContext('2d');
    if (fCtx) charts.financial = new Chart(fCtx, { type:'bar',
      data:{ labels:financial.map(r=>r.code),
        datasets:[
          { label:'Orçado', data:financial.map(r=>r.budget/1000), backgroundColor:'rgba(46,125,50,.25)', borderColor:'#2E7D32', borderWidth:1.5, borderRadius:4 },
          { label:'Realizado', data:financial.map(r=>r.actual_cost/1000), backgroundColor:'rgba(46,125,50,.65)', borderRadius:4 }
        ] },
      options:{ plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10 } } },
        scales:{ x:{ grid:{ color:'#F5F5F5' } }, y:{ beginAtZero:true, ticks:{ callback:v=>'R$'+v+'k' }, grid:{ color:'#F5F5F5' } } } } });

    destroyChart('evolution');
    const eCtx = document.getElementById('chart-evolution')?.getContext('2d');
    if (eCtx && evolution.length) charts.evolution = new Chart(eCtx, { type:'line',
      data:{ labels:evolution.map(r=>r.week),
        datasets:[
          { label:'Real', data:evolution.map(r=>r.avg_actual), borderColor:'#2E7D32', backgroundColor:'rgba(46,125,50,.1)', fill:true, tension:.4, pointRadius:3 },
          { label:'Planejado', data:evolution.map(r=>r.avg_planned), borderColor:'#1565C0', borderDash:[5,3], fill:false, tension:.4, pointRadius:2 }
        ] },
      options:{ plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10 } } },
        scales:{ x:{ grid:{ color:'#F5F5F5' } }, y:{ beginAtZero:true, max:100, ticks:{ callback:v=>v+'%' }, grid:{ color:'#F5F5F5' } } } } });

    // Painel de atrasados
    const tbody = document.getElementById('critical-tbody');
    if (tbody) tbody.innerHTML = critical.length ? critical.map(p => `<tr>
      <td class="td-main">${p.area||'—'}</td><td>${p.name}</td><td>${statusBadge(p.status)}</td>
      <td>${progressEl(parseFloat(p.progress)||0)}</td>
      <td style="color:var(--danger);font-weight:500">${p.end_date||'—'}</td>
      <td>${p.active_risks>0?`<span class="badge badge-red">${p.active_risks}</span>`:'<span style="color:var(--text3)">—</span>'}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty-state" style="padding:16px">Nenhum projeto atrasado ✅</td></tr>';

  } catch(e) { toast('Erro no dashboard: '+e.message,'error'); }
}

/* ═════════════════════════ PROJECTS ═════════════════════════════ */
let _projects = [];

async function loadProjects() {
  const tbody = document.getElementById('projects-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="loading"><div class="spinner"></div></td></tr>';
  try {
    _projects = await GET('/projects');
    renderProjects(_projects);
    loadProjectSelect('proj-filter-project');
  } catch(e) { toast(e.message,'error'); }
}

function renderProjects(list) {
  const tbody = document.getElementById('projects-tbody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML='<tr><td colspan="11" class="empty-state">Nenhum projeto encontrado</td></tr>'; return; }
  tbody.innerHTML = list.map(p => `<tr>
    <td class="td-main">${p.code}</td>
    <td><b>${p.name}</b><br><small style="color:var(--text3)">${p.area||''}</small></td>
    <td>${p.manager_name||'—'}</td>
    <td>${fmtDate(p.start_date)}</td><td>${fmtDate(p.end_date)}</td>
    <td class="status-cell">${statusBadge(p.status)}</td>
    <td>${priorityBadge(p.priority)}</td>
    <td>${fmtCurrency(p.budget)}</td>
    <td>${progressEl(p.progress, true, p.id)}</td>
    <td>${p.active_risks>0?`<span class="badge badge-red">${p.active_risks}</span>`:'—'}</td>
    <td><div class="td-actions">
      <button class="btn btn-sm btn-secondary btn-icon" onclick="viewProject(${p.id})" title="Detalhes">👁</button>
      <button class="btn btn-sm btn-secondary btn-icon" onclick="openWeeklyUpdate(${p.id}, this)" title="Update Semanal" data-name="${p.name.replace(/"/g,'&quot;')}">📝</button>
      <button class="btn btn-sm btn-secondary btn-icon" onclick="exportReport(${p.id})" title="Exportar PDF">🖨</button>
      <button class="btn btn-sm btn-secondary btn-icon" onclick="editProject(${p.id})" title="Editar">✏️</button>
      <button class="btn btn-sm btn-danger btn-icon" onclick="deleteProject(${p.id},'${p.name.replace(/'/g,'')}')">🗑</button>
    </div></td>
  </tr>`).join('');
}

function filterProjects() {
  const search = document.getElementById('proj-search')?.value?.toLowerCase()||'';
  const status = document.getElementById('proj-filter-status')?.value||'';
  const area   = document.getElementById('proj-filter-area')?.value||'';
  renderProjects(_projects.filter(p =>
    (!search || p.name.toLowerCase().includes(search) || p.code.toLowerCase().includes(search)) &&
    (!status || p.status === status) && (!area || p.area === area)));
}

async function viewProject(id) {
  try {
    const [p, kpis] = await Promise.all([GET('/projects/'+id), GET('/projects/'+id+'/kpis')]);
    document.getElementById('view-title').textContent = `${p.code} — ${p.name}`;
    document.getElementById('view-body').innerHTML = `
      <div class="grid g3" style="margin-bottom:16px">
        ${kpiMini('Progresso Real', p.progress+'%')} ${kpiMini('Planejado', kpis.plannedProgress+'%')} 
        <div class="card" style="display:flex;align-items:center;justify-content:center;gap:10px">${healthBadge(kpis.healthScore)}<div><div style="font-size:13px;font-weight:600">Health Score</div><div style="font-size:11px;color:var(--text2)">${kpis.healthScore>=80?'Saudável':kpis.healthScore>=60?'Alerta':'Crítico'}</div></div></div>
      </div>
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card">
          <div style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;margin-bottom:8px">EVM</div>
          <div class="metric-row"><div class="metric-name">SPI (Prazo)</div><div class="metric-val" style="color:${kpis.SPI>=1?'var(--success)':'var(--err)'}">${kpis.SPI}</div></div>
          <div class="metric-row"><div class="metric-name">CPI (Custo)</div><div class="metric-val" style="color:${kpis.CPI>=1?'var(--success)':'var(--err)'}">${kpis.CPI}</div></div>
          <div class="metric-row"><div class="metric-name">Orçado</div><div class="metric-val">${fmtCurrency(kpis.budget)}</div></div>
          <div class="metric-row"><div class="metric-name">Realizado</div><div class="metric-val">${fmtCurrency(kpis.actualCost)}</div></div>
          ${kpis.scheduleDeviation!=null?`<div class="metric-row"><div class="metric-name">Desvio cronograma</div><div class="metric-val" style="color:${kpis.scheduleDeviation<=0?'var(--success)':'var(--err)'}">${kpis.scheduleDeviation>0?'+':''}${kpis.scheduleDeviation} dias</div></div>`:''}
        </div>
        <div class="card">
          <div style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;margin-bottom:8px">Objetivo</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:12px">${p.objective||'—'}</div>
          <div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;margin-bottom:4px">Critérios de Sucesso</div>
          <div style="font-size:12px;color:var(--text2)">${p.success_criteria||'—'}</div>
        </div>
      </div>
      ${p.tasks?.length?`<div style="margin-bottom:16px"><div class="chart-title">Tarefas (${p.tasks.length})</div>
      <div class="table-wrap"><table><thead><tr><th>Cód</th><th>Tarefa</th><th>Status</th><th>Progresso</th><th>Responsável</th><th>Prazo</th></tr></thead>
      <tbody>${p.tasks.map(t=>`<tr><td style="font-size:11px;color:var(--text2)">${t.eap_code||''}</td><td class="td-main">${t.milestone?'🏁 ':''}${t.name}</td><td>${statusBadge(t.status)}</td><td>${progressEl(t.progress)}</td><td>${t.assignee_name||'—'}</td><td>${fmtDate(t.end_date)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
      ${p.risks?.length?`<div><div class="chart-title">Riscos (${p.risks.length})</div>
      <div class="table-wrap"><table><thead><tr><th>Código</th><th>Descrição</th><th>Severidade</th><th>Status</th></tr></thead>
      <tbody>${p.risks.map(r=>`<tr><td>${r.code||'—'}</td><td class="td-main">${r.description}</td><td>${riskBadge(r.severity)}</td><td>${statusBadge(r.status)}</td></tr>`).join('')}</tbody></table></div></div>`:''}`;
    openModal('modal-view');
  } catch(e) { toast(e.message,'error'); }
}

function kpiMini(label, val) {
  return `<div class="card" style="text-align:center"><div style="font-size:24px;font-weight:700;color:var(--text);letter-spacing:-1px">${val}</div><div style="font-size:11px;color:var(--text2);margin-top:4px;text-transform:uppercase;letter-spacing:.5px">${label}</div></div>`;
}

async function openCreateProject() {
  document.getElementById('proj-form').reset();
  document.getElementById('proj-form-id').value='';
  document.getElementById('proj-modal-title').textContent='Novo Projeto';
  await loadUserSelect('proj-manager');
  openModal('modal-project');
}

async function editProject(id) {
  try {
    const p = await GET('/projects/'+id);
    document.getElementById('proj-form-id').value=p.id;
    document.getElementById('proj-modal-title').textContent='Editar — '+p.name;
    await loadUserSelect('proj-manager', p.manager_id);
    const fs=['code','name','description','area','start_date','end_date','status','priority','budget','actual_cost','progress','complexity','strategic_impact','objective','scope_in','scope_out','success_criteria'];
    fs.forEach(f => {
      const el = document.getElementById('proj-' + f.replace(/_/g, '-'));
      if (!el) return;
      let val = p[f] ?? '';
      // Normaliza datas: remove timestamp do PostgreSQL
      if ((f === 'start_date' || f === 'end_date') && val) {
        val = String(val).replace(' ', 'T').split('T')[0];
      }
      el.value = val;
    });
    openModal('modal-project');
  } catch(e) { toast(e.message,'error'); }
}

async function saveProject(e) {
  e.preventDefault();
  const id = document.getElementById('proj-form-id').value;
  const flds = ['code','name','description','area','manager_id','start_date','end_date','status','priority','budget','actual_cost','progress','complexity','strategic_impact','objective','scope_in','scope_out','success_criteria'];
  const body = {};
  flds.forEach(f => { const el=document.getElementById('proj-'+f.replace(/_/g,'-')); if(el) body[f]=el.value||null; });
  body.budget=parseFloat(body.budget)||0; body.actual_cost=parseFloat(body.actual_cost)||0; body.progress=parseFloat(body.progress)||0;
  try {
    if (id) await PUT('/projects/'+id, body); else await POST('/projects', body);
    toast(id?'Projeto atualizado!':'Projeto criado!','success');
    closeModal('modal-project'); loadProjects(); loadDashboard();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteProject(id, name) {
  if (!confirm(`Remover projeto "${name}"? Tarefas e riscos serão excluídos.`)) return;
  try { await DELETE('/projects/'+id); toast('Projeto removido','success'); loadProjects(); loadDashboard(); }
  catch(e) { toast(e.message,'error'); }
}

/* ═════════════════════════ TASKS ════════════════════════════════ */
let _tasks = [];


/* Ordena array de tarefas pela hierarquia EAP: 1 < 1.1 < 1.2 < 2 < 2.1 */
function _sortEAP(tasks) {
  return [...tasks].sort((a, b) => {
    const ka = String(a.eap_code||'9999').split('.').map(n => parseInt(n)||0);
    const kb = String(b.eap_code||'9999').split('.').map(n => parseInt(n)||0);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const diff = (ka[i]||0) - (kb[i]||0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

async function loadTasks() {
  const tbody = document.getElementById('tasks-tbody');
  if (tbody) tbody.innerHTML='<tr><td colspan="9" class="loading"><div class="spinner"></div></td></tr>';
  try {
    _tasks = await GET('/tasks');
    renderTasks(_tasks);
    loadProjectSelect('task-filter-project');
    loadProjectSelect('task-proj-id', null, '— Selecionar projeto —');
  } catch(e) { toast(e.message,'error'); }
}

function renderTasks(list) {
  const tbody = document.getElementById('tasks-tbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhuma tarefa encontrada</td></tr>';
    return;
  }

  // Ordena por EAP antes de renderizar
  const sorted = _sortEAP(list);

  tbody.innerHTML = sorted.map(t => {
    const isObj    = t.eap_level === 1;
    const indent   = Math.max(0, (t.eap_level - 1)) * 20;
    const prog     = Math.round(t.progress || 0);
    const progColor = prog >= 80 ? 'var(--g600)' : prog >= 40 ? '#E65100' : '#C62828';

    // Estilo da linha: objetivo = fundo verde claro + negrito, ação = normal
    const rowStyle = isObj
      ? 'background:var(--g50);border-top:2px solid var(--border-md)'
      : '';

    return '<tr style="' + rowStyle + '">' +
      // Projeto
      '<td><span class="badge badge-blue" style="font-size:10px">' + (t.project_code||'—') + '</span></td>' +
      // EAP + Nome
      '<td class="td-main" style="padding-left:' + (indent + 12) + 'px">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          (isObj ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:var(--g700);color:#fff;border-radius:6px;font-size:10px;font-weight:700;flex-shrink:0">' + (t.eap_code||'') + '</span>' :
                   '<span style="font-size:11px;font-weight:600;color:var(--g700);flex-shrink:0;min-width:28px">' + (t.eap_code||'') + '</span>') +
          '<span style="font-weight:' + (isObj ? '700' : '400') + '">' + t.name + '</span>' +
          (t.milestone ? ' <span title="Marco">🏁</span>' : '') +
        '</div>' +
      '</td>' +
      // Status
      '<td>' + statusBadge(t.status) + '</td>' +
      // Progresso
      '<td><div class="progress-inline">' +
        '<input type="range" min="0" max="100" value="' + prog + '" ' +
          'oninput="this.nextElementSibling.textContent=this.value+'%'" ' +
          'onchange="inlineTaskProgress(' + t.id + ',this.value);var x=_tasks.find(x=>x.id==' + t.id + ');if(x)x.progress=+this.value">' +
        '<span>' + prog + '%</span>' +
      '</div></td>' +
      // Datas
      '<td style="font-size:12px">' + fmtDate(t.start_date) + '</td>' +
      '<td style="font-size:12px">' + fmtDate(t.end_date) + '</td>' +
      // Responsável
      '<td style="font-size:12px;color:var(--text2)">' + (t.assignee_name||'—') + '</td>' +
      // Marco
      '<td style="text-align:center">' + (t.milestone ? '✅' : '—') + '</td>' +
      // Ações
      '<td><div class="td-actions">' +
        '<button class="btn btn-sm btn-secondary btn-icon" onclick="openTaskUpdates(' + t.id + ', this)" title="Atividades semanais" data-name="' + t.name.replace(/"/g,'&quot;') + '">📋</button>' +
        '<button class="btn btn-sm btn-secondary btn-icon" onclick="editTask(' + t.id + ')">✏️</button>' +
        '<button class="btn btn-sm btn-danger btn-icon" onclick="deleteTask(' + t.id + ',&quot;' + t.name.replace(/"/g,'') + '&quot;)">🗑</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function filterTasks() {
  const pid    = document.getElementById('task-filter-project')?.value || '';
  const eapLvl = document.getElementById('task-filter-eap')?.value || '';
  const status = document.getElementById('task-filter-status')?.value || '';
  const search = (document.getElementById('task-search')?.value || '').toLowerCase();

  renderTasks(_tasks.filter(t => {
    if (pid    && t.project_id != pid)                         return false;
    if (eapLvl && String(t.eap_level) !== eapLvl)             return false;
    if (status && t.status !== status)                         return false;
    if (search && !t.name.toLowerCase().includes(search) &&
                  !(t.eap_code||'').toLowerCase().includes(search)) return false;
    return true;
  }));
}

async function openCreateTask() {
  document.getElementById('task-form').reset();
  document.getElementById('task-form-id').value='';
  document.getElementById('task-modal-title').textContent='Nova Tarefa';
  await Promise.all([loadProjectSelect('task-proj-id',null,'— Selecionar projeto —'), loadUserSelect('task-assignee')]);
  openModal('modal-task');
}

async function editTask(id) {
  try {
    const t = await GET('/tasks/'+id);
    document.getElementById('task-form-id').value=t.id;
    document.getElementById('task-modal-title').textContent='Editar Tarefa';
    await Promise.all([loadProjectSelect('task-proj-id',t.project_id,'— Selecionar projeto —'), loadUserSelect('task-assignee',t.assignee_id)]);
    ['name','description','start_date','end_date','progress','status','eap_level','eap_code'].forEach(f => {
      const el = document.getElementById('task-' + f.replace(/_/g, '-'));
      if (!el) return;
      let val = t[f] ?? '';
      // Normaliza datas (remove timestamp do PostgreSQL)
      if ((f === 'start_date' || f === 'end_date') && val) {
        val = String(val).replace(' ', 'T').split('T')[0];
      }
      el.value = val;
    });
    document.getElementById('task-milestone').checked = !!t.milestone;
    openModal('modal-task');
  } catch(e) { toast(e.message,'error'); }
}

async function saveTask(e) {
  e.preventDefault();
  const id = document.getElementById('task-form-id').value;
  const body = {
    project_id:  document.getElementById('task-proj-id').value,
    name:        document.getElementById('task-name').value,
    description: document.getElementById('task-description').value,
    start_date:  document.getElementById('task-start-date').value||null,
    end_date:    document.getElementById('task-end-date').value||null,
    progress:    parseFloat(document.getElementById('task-progress').value)||0,
    status:      document.getElementById('task-status').value,
    assignee_id: document.getElementById('task-assignee').value||null,
    milestone:   document.getElementById('task-milestone').checked?1:0,
    eap_level:   parseInt(document.getElementById('task-eap-level').value)||1,
    eap_code:    document.getElementById('task-eap-code').value||null,
  };
  try {
    if (id) await PUT('/tasks/'+id, body); else await POST('/tasks', body);
    toast(id?'Tarefa atualizada!':'Tarefa criada!','success');
    closeModal('modal-task'); loadTasks();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteTask(id, name) {
  if (!confirm(`Remover tarefa "${name}"?`)) return;
  try { await DELETE('/tasks/'+id); toast('Tarefa removida','success'); loadTasks(); }
  catch(e) { toast(e.message,'error'); }
}

/* ═════════════════════════ RISKS ════════════════════════════════ */
let _risks = [];

async function loadRisks() {
  const tbody = document.getElementById('risks-tbody');
  if (tbody) tbody.innerHTML='<tr><td colspan="10" class="loading"><div class="spinner"></div></td></tr>';
  try {
    _risks = await GET('/risks');
    renderRisks(_risks);
    loadProjectSelect('risk-filter-project');
    loadProjectSelect('risk-proj-id',null,'— Selecionar projeto —');
  } catch(e) { toast(e.message,'error'); }
}

function renderRisks(list) {
  const tbody = document.getElementById('risks-tbody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML='<tr><td colspan="10" class="empty-state">Nenhum risco</td></tr>'; return; }
  tbody.innerHTML = list.map(r => `<tr>
    <td><span class="badge badge-blue">${r.project_code}</span></td>
    <td>${r.code||'—'}</td>
    <td class="td-main" style="max-width:200px">${r.description}</td>
    <td style="text-align:center">${r.probability}</td><td style="text-align:center">${r.impact}</td>
    <td>${riskBadge(r.severity)}</td>
    <td style="max-width:180px;font-size:11px;color:var(--text2)">${r.mitigation||'—'}</td>
    <td>${r.owner_name||'—'}</td><td>${statusBadge(r.status)}</td>
    <td><div class="td-actions">
      <button class="btn btn-sm btn-secondary btn-icon" onclick="editRisk(${r.id})">✏️</button>
      <button class="btn btn-sm btn-danger btn-icon" onclick="deleteRisk(${r.id})">🗑</button>
    </div></td>
  </tr>`).join('');
}

function filterRisks() {
  const pid = document.getElementById('risk-filter-project')?.value||'';
  const st  = document.getElementById('risk-filter-status')?.value||'';
  renderRisks(_risks.filter(r=>(!pid||r.project_id==pid)&&(!st||r.status===st)));
}

function updateSeverityPreview() {
  const p=parseInt(document.getElementById('risk-probability')?.value)||0;
  const i=parseInt(document.getElementById('risk-impact')?.value)||0;
  const el=document.getElementById('risk-severity-preview');
  if (el) el.innerHTML=riskBadge(p*i);
}

async function openCreateRisk() {
  document.getElementById('risk-form').reset();
  document.getElementById('risk-form-id').value='';
  document.getElementById('risk-modal-title').textContent='Novo Risco';
  await Promise.all([loadProjectSelect('risk-proj-id',null,'— Selecionar projeto —'), loadUserSelect('risk-owner')]);
  updateSeverityPreview();
  openModal('modal-risk');
}

async function editRisk(id) {
  try {
    const r = await GET('/risks/'+id);
    document.getElementById('risk-form-id').value=r.id;
    document.getElementById('risk-modal-title').textContent='Editar Risco';
    await Promise.all([loadProjectSelect('risk-proj-id',r.project_id,'— Selecionar projeto —'), loadUserSelect('risk-owner',r.owner_id)]);
    ['code','description','probability','impact','mitigation','contingency','status'].forEach(f=>{
      const el=document.getElementById('risk-'+f); if(el) el.value=r[f]??'';
    });
    updateSeverityPreview();
    openModal('modal-risk');
  } catch(e) { toast(e.message,'error'); }
}

async function saveRisk(e) {
  e.preventDefault();
  const id = document.getElementById('risk-form-id').value;
  const body = {
    project_id:  document.getElementById('risk-proj-id').value,
    code:        document.getElementById('risk-code').value,
    description: document.getElementById('risk-description').value,
    probability: parseInt(document.getElementById('risk-probability').value),
    impact:      parseInt(document.getElementById('risk-impact').value),
    mitigation:  document.getElementById('risk-mitigation').value,
    contingency: document.getElementById('risk-contingency').value,
    owner_id:    document.getElementById('risk-owner').value||null,
    status:      document.getElementById('risk-status').value,
  };
  try {
    if (id) await PUT('/risks/'+id, body); else await POST('/risks', body);
    toast(id?'Risco atualizado!':'Risco registrado!','success');
    closeModal('modal-risk'); loadRisks();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteRisk(id) {
  if (!confirm('Remover este risco?')) return;
  try { await DELETE('/risks/'+id); toast('Risco removido','success'); loadRisks(); }
  catch(e) { toast(e.message,'error'); }
}

/* ════════════════════════ RESOURCES ═════════════════════════════ */
let _resources=[];

async function loadResources() {
  const tbody=document.getElementById('resources-tbody');
  if(tbody) tbody.innerHTML='<tr><td colspan="8" class="loading"><div class="spinner"></div></td></tr>';
  try { _resources=await GET('/resources'); renderResources(_resources); }
  catch(e) { toast(e.message,'error'); }
}

function renderResources(list) {
  const tbody=document.getElementById('resources-tbody');
  if(!tbody) return;
  if(!list.length){tbody.innerHTML='<tr><td colspan="8" class="empty-state">Nenhum recurso</td></tr>';return;}
  tbody.innerHTML=list.map(r=>{
    const wl=r.total_workload||0;
    const cls=wl>100?'badge-red':wl>80?'badge-yellow':'badge-green';
    return `<tr>
      <td class="td-main">${r.name}</td><td>${r.role||'—'}</td><td>${r.email||'—'}</td>
      <td><span class="badge ${cls}">${wl}%</span></td>
      <td>${fmtCurrency(r.cost_month)}/mês</td>
      <td>${r.project_count||0}</td><td>${r.availability}%</td>
      <td><div class="td-actions">
        <button class="btn btn-sm btn-secondary btn-icon" onclick="editResource(${r.id})">✏️</button>
        <button class="btn btn-sm btn-success btn-icon" onclick="openAlloc(${r.id},'${r.name.replace(/'/g,'')}')">📌</button>
        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteResource(${r.id},'${r.name.replace(/'/g,'')}')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
}

async function openCreateResource(){ document.getElementById('res-form').reset(); document.getElementById('res-form-id').value=''; document.getElementById('res-modal-title').textContent='Novo Recurso'; openModal('modal-resource'); }

async function editResource(id){ try{ const r=await GET('/resources/'+id); document.getElementById('res-form-id').value=r.id; document.getElementById('res-modal-title').textContent='Editar Recurso'; ['name','role','email','cost_month','availability'].forEach(f=>{const el=document.getElementById('res-'+f.replace(/_/g,'-'));if(el)el.value=r[f]??'';}); openModal('modal-resource'); }catch(e){toast(e.message,'error');} }

async function saveResource(e){ e.preventDefault(); const id=document.getElementById('res-form-id').value; const body={name:document.getElementById('res-name').value,role:document.getElementById('res-role').value,email:document.getElementById('res-email').value,cost_month:parseFloat(document.getElementById('res-cost-month').value)||0,availability:parseFloat(document.getElementById('res-availability').value)||100}; try{ if(id) await PUT('/resources/'+id,body); else await POST('/resources',body); toast(id?'Atualizado!':'Criado!','success'); closeModal('modal-resource'); loadResources(); }catch(e){toast(e.message,'error');} }

async function deleteResource(id,name){ if(!confirm(`Remover "${name}"?`))return; try{await DELETE('/resources/'+id);toast('Removido','success');loadResources();}catch(e){toast(e.message,'error');} }

let _allocResId=null;
async function openAlloc(id,name){ _allocResId=id; set$('alloc-res-name',name); await loadProjectSelect('alloc-proj-id',null,'— Selecionar projeto —'); openModal('modal-alloc'); }
async function saveAlloc(e){ e.preventDefault(); const body={project_id:document.getElementById('alloc-proj-id').value,workload:parseFloat(document.getElementById('alloc-workload').value),start_date:document.getElementById('alloc-start').value||null,end_date:document.getElementById('alloc-end').value||null}; try{await POST('/resources/'+_allocResId+'/allocate',body);toast('Alocação salva!','success');closeModal('modal-alloc');loadResources();}catch(e){toast(e.message,'error');} }

/* ════════════════════════ GANTT ══════════════════════════════════ */
async function loadGantt() {
  const container=document.getElementById('gantt-body');
  if(!container){return;}
  container.innerHTML='<div class="loading"><div class="spinner"></div> Carregando Gantt…</div>';
  try {
    const pid=document.getElementById('gantt-filter')?.value;
    const url='/dashboard/gantt'+(pid?'?project_id='+pid:'');
    const tasks=await GET(url);
    await loadProjectSelect('gantt-filter',pid);
    if(!tasks.length){container.innerHTML='<div class="empty-state">Nenhuma tarefa com datas definidas</div>';return;}
    renderGantt(tasks,container);
  } catch(e){container.innerHTML='<div class="empty-state">Erro: '+e.message+'</div>';}
}

function renderGantt(tasks,container) {
  const today=ganttPct(new Date().toISOString().split('T')[0]);
  const months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const grouped={};
  tasks.forEach(t=>{if(!grouped[t.project_code])grouped[t.project_code]={name:t.project_name,tasks:[]};grouped[t.project_code].tasks.push(t);});

  let html=`<div class="gantt-inner"><div style="display:flex;margin-bottom:6px"><div style="width:250px;flex-shrink:0"></div>
    <div style="flex:1;display:grid;grid-template-columns:repeat(12,1fr);font-size:10px;color:var(--text2);text-align:center">${months.map(m=>'<div>'+m+'</div>').join('')}</div></div>`;

  for(const [code,proj] of Object.entries(grouped)){
    html+=`<div class="gantt-row"><div class="gantt-label"><div class="gantt-label-main">📁 ${code} — ${proj.name}</div></div><div class="gantt-track" style="background:transparent;border:none;position:relative"><div class="today-line" style="left:${today}%"></div></div></div>`;
    proj.tasks.forEach(t=>{
      const left=ganttPct(t.start_date), right=ganttPct(t.end_date), width=Math.max(right-left,.5);
      const bleft=t.baseline_start?ganttPct(t.baseline_start):null;
      const bright=t.baseline_end?ganttPct(t.baseline_end):null;
      const bwidth=bleft!=null&&bright!=null?Math.max(bright-bleft,.5):0;
      const cls=ganttBarCls(t.status);
      html+=`<div class="gantt-row" style="padding-left:12px">
        <div class="gantt-label"><div class="gantt-label-sub">${t.milestone?'🏁 ':'  '}${t.eap_code?t.eap_code+' ':''}${t.name}</div><div style="font-size:9px;color:var(--text3)">${t.assignee_name||''}</div></div>
        <div class="gantt-track" style="position:relative">
          <div class="today-line" style="left:${today}%;opacity:.3"></div>
          ${bleft!=null?`<div class="gantt-baseline" style="left:${bleft}%;width:${bwidth}%" title="Baseline: ${fmtDate(t.baseline_start)} → ${fmtDate(t.baseline_end)}"></div>`:''}
          <div class="gantt-bar ${cls}" style="left:${left}%;width:${width}%" title="${t.name} · ${fmtDate(t.start_date)} → ${fmtDate(t.end_date)} · ${t.progress}%">
            ${width>8?t.name:''}
          </div>
        </div>
      </div>`;
    });
  }
  html+=`</div>`;
  container.innerHTML=html;
}

/* ════════════════════════ KPIs ══════════════════════════════════ */
async function loadKpis() {
  const tbody=document.getElementById('kpis-tbody');
  if(tbody)tbody.innerHTML='<tr><td colspan="9" class="loading"><div class="spinner"></div></td></tr>';
  try {
    const projects=await GET('/projects');
    const active=projects.filter(p=>p.status!=='Cancelado').slice(0,12);
    const rows=await Promise.all(active.map(p=>GET('/projects/'+p.id+'/kpis').then(k=>({p,k})).catch(()=>null)));
    if(!tbody)return;
    tbody.innerHTML=rows.filter(Boolean).map(({p,k})=>{
      const sc=k.SPI>=1?'var(--success)':k.SPI>=.8?'var(--warn)':'var(--err)';
      const cc=k.CPI>=1?'var(--success)':k.CPI>=.8?'var(--warn)':'var(--err)';
      return `<tr>
        <td class="td-main">${p.code}</td><td>${p.name}</td>
        <td>${fmtCurrency(k.PV)}</td><td>${fmtCurrency(k.EV)}</td><td>${fmtCurrency(k.AC)}</td>
        <td style="font-weight:700;color:${sc}">${k.SPI}</td>
        <td style="font-weight:700;color:${cc}">${k.CPI}</td>
        <td style="color:${k.SV>=0?'var(--success)':'var(--err)'}">${k.SV>=0?'+':''}${fmtCurrency(k.SV)}</td>
        <td>${healthBadge(k.healthScore)}</td>
      </tr>`;
    }).join('');
  } catch(e){toast(e.message,'error');}
}

/* ══════════════════════ BI ══════════════════════════════════════ */
async function loadBi() {
  try {
    const [mgrs,,financial]=await Promise.all([GET('/dashboard/manager-performance'),GET('/dashboard/by-area'),GET('/dashboard/financial')]);
    const COLORS=['#2E7D32','#1565C0','#E65100','#455A64'];

    destroyChart('bi-mgr');
    const mc=document.getElementById('bi-chart-mgr')?.getContext('2d');
    if(mc&&mgrs.length) charts['bi-mgr']=new Chart(mc,{type:'radar',
      data:{labels:['Progresso','No Prazo','Orçamento','Projetos','Concluídos'],
        datasets:mgrs.slice(0,4).map((m,i)=>({label:m.manager,
          data:[m.avg_progress,Math.max(0,100-m.delayed_count*25),m.total_budget>0?Math.min(100,100-((m.total_actual/m.total_budget*100)-100)):50,Math.min(m.project_count*20,100),Math.min(m.done_count*33,100)],
          borderColor:COLORS[i],backgroundColor:COLORS[i]+'18',pointBackgroundColor:COLORS[i],pointRadius:3,borderWidth:2}))},
      options:{scales:{r:{beginAtZero:true,max:100,ticks:{display:false},grid:{color:'#E0E0E0'},pointLabels:{color:'#616161'}}},plugins:{legend:{position:'bottom',labels:{boxWidth:10}}}}});

    destroyChart('bi-burn');
    const bc=document.getElementById('bi-chart-burn')?.getContext('2d');
    if(bc) charts['bi-burn']=new Chart(bc,{type:'bar',
      data:{labels:financial.map(r=>r.code),
        datasets:[{label:'Orçado (R$k)',data:financial.map(r=>r.budget/1000),backgroundColor:'rgba(46,125,50,.2)',borderColor:'#2E7D32',borderWidth:1.5,borderRadius:4},{label:'Realizado (R$k)',data:financial.map(r=>r.actual_cost/1000),backgroundColor:'rgba(46,125,50,.65)',borderRadius:4}]},
      options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10}}},scales:{x:{grid:{color:'#F5F5F5'}},y:{beginAtZero:true,ticks:{callback:v=>v+'k'},grid:{color:'#F5F5F5'}}}}});

    const bt=document.getElementById('bi-mgr-tbody');
    if(bt) bt.innerHTML=mgrs.map(m=>`<tr><td class="td-main">${m.manager}</td><td>${m.project_count}</td><td>${progressEl(m.avg_progress)}</td><td>${fmtCurrency(m.total_budget)}</td><td>${fmtCurrency(m.total_actual)}</td><td>${m.delayed_count>0?`<span class="badge badge-red">${m.delayed_count}</span>`:'—'}</td><td><span class="badge badge-green">${m.done_count}</span></td></tr>`).join('');
  } catch(e){toast(e.message,'error');}
}

/* ══════════════════════ INTEGRATIONS ════════════════════════════ */
async function loadIntegrations() {
  try {
    const s=await GET('/integrations/status');
    const gc=s.google?.connected;
    document.getElementById('google-badge').innerHTML=gc?'<span class="badge badge-green">Conectado</span>':'<span class="badge badge-neutral">Não conectado</span>';
    document.getElementById('google-detail').textContent=gc?(s.google.calendar_enabled?'Google conectado com Calendar habilitado.':'Google conectado. Reconecte para habilitar Calendar.'):'Conecte para ativar login Google e Calendar.';
    document.getElementById('btn-connect-google').style.display=gc?'none':'inline-flex';
    document.getElementById('btn-disconnect-google').style.display=gc?'inline-flex':'none';
    document.getElementById('cal-badge').innerHTML=s.google?.calendar_enabled?'<span class="badge badge-green">Ativo</span>':'<span class="badge badge-neutral">Inativo</span>';
    document.getElementById('cal-events').textContent=s.stats?.calendar_events>0?s.stats.calendar_events+' evento(s) sincronizado(s)':'';
  } catch {}
}

function connectGoogle() { window.location.href='/api/auth/google?user_id='+(Auth.user?.id||''); }
async function disconnectGoogle() {
  if(!confirm('Desconectar Google?'))return;
  try { await DELETE('/auth/google/disconnect'); toast('Desconectado','success'); loadIntegrations(); }
  catch(e){toast(e.message,'error');}
}

async function syncCalendar() {
  try { toast('Sincronizando…','info'); const d=await POST('/calendar/sync',{}); toast(d.message||'Sincronizado!','success'); loadIntegrations(); }
  catch(e){toast(e.message,'error');}
}

/* ══════════════════════ PROFILE ═════════════════════════════════ */
function openProfile() {
  const u=Auth.user;
  if(!u)return;
  const av=document.getElementById('profile-avatar');
  if(av){ if(u.avatar_url)av.innerHTML=`<img src="${u.avatar_url}">`; else av.textContent=(u.name||'U').charAt(0).toUpperCase(); }
  set$('profile-name',u.name); set$('profile-email',u.email); set$('profile-role',u.role);
  document.getElementById('profile-name-input').value=u.name||'';
  document.getElementById('pw-form').reset();
  openModal('modal-profile');
}

async function saveName(e) {
  e.preventDefault();
  const name=document.getElementById('profile-name-input').value.trim();
  if(!name)return;
  try {
    await PUT('/auth/me',{name});
    const u=Auth.user; u.name=name; Auth.set(Auth.token,u,Auth.refresh);
    set$('user-name',name); set$('profile-name',name);
    toast('Nome atualizado!','success');
  } catch(e){toast(e.message,'error');}
}

async function savePassword(e) {
  e.preventDefault();
  const current=document.getElementById('pw-current').value;
  const newPass=document.getElementById('pw-new').value;
  const confirm_=document.getElementById('pw-confirm').value;
  if(newPass!==confirm_){toast('As senhas não coincidem','error');return;}
  try { await PUT('/auth/me/password',{current,newPassword:newPass}); toast('Senha alterada! Faça login novamente.','success'); setTimeout(doLogout,1500); }
  catch(e){toast(e.message,'error');}
}

/* ═══════════════════════ SECTION LOADERS ════════════════════════ */
Object.assign(sectionLoaders, {
  dashboard:    loadDashboard,
  projects:     loadProjects,
  tasks:        loadTasks,
  risks:        loadRisks,
  resources:    loadResources,
  gantt:        loadGantt,
  kpis:         loadKpis,
  bi:           loadBi,
  integrations: loadIntegrations,
});


/* ═══════════════════════════════════════════════════════
   SELETOR DE DEPARTAMENTO (pós-login / troca em tela)
═══════════════════════════════════════════════════════ */

function showDeptSelector(departments) {
  let overlay = document.getElementById('dept-selector-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dept-selector-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(overlay);
  }
  const depts = departments || Auth.departments;

  // Limpa e reconstrói via DOM (sem nested template literals)
  overlay.innerHTML = '';

  const card = document.createElement('div');
  card.style.cssText = 'background:var(--card);border-radius:16px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.4)';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'background:linear-gradient(135deg,#1B5E20,#2E7D32);padding:28px 28px 24px;';
  header.innerHTML = '<div style="font-size:28px;margin-bottom:8px">🏢</div><div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px">Selecionar Departamento</div><div style="font-size:13px;color:rgba(255,255,255,.75)">Escolha com qual área deseja trabalhar agora</div>';
  card.appendChild(header);

  // Buttons
  const body = document.createElement('div');
  body.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow-y:auto';
  depts.forEach(dept => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'width:100%;padding:12px 16px;background:var(--subtle);border:1.5px solid var(--border);border-radius:10px;font-size:14px;font-weight:500;color:var(--text);cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:all .15s';
    btn.innerHTML = '<span style="font-size:16px">🏢</span><span>' + dept + '</span>';
    btn.addEventListener('mouseenter', () => { btn.style.borderColor='#2E7D32'; btn.style.background='var(--g50)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor='var(--border)'; btn.style.background='var(--subtle)'; });
    btn.addEventListener('click', () => selectDepartment(dept, btn));
    body.appendChild(btn);
  });
  card.appendChild(body);
  overlay.appendChild(card);
  overlay.style.display = 'flex';
}

async function selectDepartment(dept, btnEl) {
  const btns = document.querySelectorAll('#dept-selector-overlay button');
  btns.forEach(b => b.disabled = true);
  if (btnEl) { btnEl.style.borderColor='var(--g600)'; btnEl.style.background='var(--g50)'; }
  try {
    const d = await POST('/auth/switch-department', { department: dept });
    Auth.set(d.accessToken || d.token, d.user, d.refreshToken);
    const overlay = document.getElementById('dept-selector-overlay');
    if (overlay) overlay.style.display = 'none';
    showApp();
    toast('Departamento: ' + dept, 'success');
  } catch(e) {
    toast('Erro ao trocar departamento: ' + e.message, 'error');
    btns.forEach(b => b.disabled = false);
  }
}

function openDeptSwitch() {
  if (!Auth.needsDeptSwitch) return;
  showDeptSelector(Auth.departments);
}


/* ═══════════════════════════════════════════════════════════
   UPDATE SEMANAL
═══════════════════════════════════════════════════════════ */
function openWeeklyUpdate(projectId, btnOrName) {
  const projectName = typeof btnOrName === 'string' ? btnOrName : btnOrName?.dataset?.name || 'Projeto';
  set$('weekly-project-name', projectName || 'Projeto');
  document.getElementById('weekly-project-id').value = projectId;
  document.getElementById('weekly-form').reset();
  document.getElementById('weekly-project-id').value = projectId;
  openModal('modal-weekly');
}
async function saveWeeklyUpdate(e) {
  e.preventDefault();
  const projectId = document.getElementById('weekly-project-id').value;
  const body = {
    comment:    document.getElementById('weekly-comment').value,
    highlights: document.getElementById('weekly-highlights').value,
    blockers:   document.getElementById('weekly-blockers').value,
    next_steps: document.getElementById('weekly-next-steps').value,
    progress:   parseFloat(document.getElementById('weekly-progress').value) || null,
    status:     document.getElementById('weekly-status').value || null,
  };
  try {
    await POST('/projects/' + projectId + '/weekly-update', body);
    toast('Update semanal registrado!', 'success');
    closeModal('modal-weekly');
    loadDashboard();
  } catch(err) { toast(err.message, 'error'); }
}

/* ═══════════════════════════════════════════════════════════
   EXPORTAÇÃO — PROJETO INDIVIDUAL (abre em nova aba para impressão)
═══════════════════════════════════════════════════════════ */
async function exportReport(projectId) {
  try {
    const p    = await GET('/projects/' + projectId);
    const user = Auth.user || {};

    // Busca atividades semanais de cada tarefa
    if (p.tasks && p.tasks.length) {
      await Promise.all(p.tasks.map(async t => {
        try { t._updates = await GET('/tasks/' + t.id + '/updates'); } catch { t._updates = []; }
      }));
    }

    // ── Ordena EAP corretamente (1 < 1.1 < 1.2 < 1.2.1 < 2 < 2.1 …) ──
    function eapKey(code) {
      if (!code) return [9999];
      return String(code).split('.').map(n => parseInt(n, 10) || 0);
    }
    function eapCompare(a, b) {
      const ka = eapKey(a.eap_code), kb = eapKey(b.eap_code);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const diff = (ka[i] || 0) - (kb[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    }
    const tasks = [...(p.tasks || [])].sort(eapCompare);

    // Extrai manager_name independente do formato retornado
    p.manager_name = (typeof p.manager_name === 'object' && p.manager_name)
      ? p.manager_name.name
      : (p.manager_name || p.manager_name_text || '—');

    const win    = window.open('', '_blank', 'width=1100,height=800');
    const fmtR   = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const fmtD = v => {
      if (!v) return '—';
      // Remove timestamp se vier do PostgreSQL (ex: "2026-03-30 00:00:00")
      const s = String(v).replace(' ', 'T').split('T')[0];
      // Aceita YYYY-MM-DD ou DD/MM/YYYY
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y,m,d] = s.split('-');
        return d + '/' + m + '/' + y;
      }
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
      return '—';
    };
    const now    = new Date();
    const nowStr = now.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    // ── Helpers de data / classificação do projeto ──
    const parseDateR = v => {
      if (!v) return null;
      const s = String(v).replace(' ','T').split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d,m,y]=s.split('/'); return new Date(`${y}-${m}-${d}T00:00:00`); }
      return null;
    };
    const ANUAL_CUTOFF_R = new Date('2027-04-01T00:00:00');
    const isAnual = (() => { const ed = parseDateR(p.end_date); return ed && ed >= ANUAL_CUTOFF_R; })();
    const trimestresR = [
      { label: '1º Trimestre', months: [1,2,3] },
      { label: '2º Trimestre', months: [4,5,6] },
      { label: '3º Trimestre', months: [7,8,9] },
      { label: '4º Trimestre', months: [10,11,12] },
    ];

    const SC = {
      'Em andamento': '#1565C0', 'Concluído': '#2E7D32',
      'Atrasado': '#C62828',     'Planejado': '#546E7A',
      'Em espera': '#6A1B9A',    'Cancelado': '#37474F'
    };

    const pColor = v => {
      const n = parseFloat(v||0);
      if (n >= 80) return '#2E7D32';
      if (n >= 40) return '#E65100';
      return '#C62828';
    };

    const css = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Inter',sans-serif;font-size:12px;color:#212121;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}

      /* ─── CAPA ─────────────────────────────────────────── */
      .cover{
        width:100%;min-height:100vh;
        background:linear-gradient(145deg,#1B5E20 0%,#2E7D32 45%,#388E3C 75%,#1B3A1B 100%);
        display:flex;flex-direction:column;justify-content:space-between;
        padding:56px 64px;page-break-after:always;position:relative;overflow:hidden
      }
      .cover::before{content:'';position:absolute;top:-100px;right:-100px;width:500px;height:500px;border-radius:50%;background:rgba(255,255,255,.035)}
      .cover::after {content:'';position:absolute;bottom:-80px;left:-80px; width:380px;height:380px;border-radius:50%;background:rgba(255,255,255,.025)}
      .c-top{display:flex;justify-content:space-between;align-items:flex-start;position:relative;z-index:1}
      .c-logo{font-size:24px;font-weight:800;color:#fff;letter-spacing:-.5px}
      .c-logo span{color:#A5D6A7}
      .c-badge{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;padding:7px 18px;border-radius:20px;font-size:12px;font-weight:500;letter-spacing:.5px}
      .c-mid{flex:1;display:flex;flex-direction:column;justify-content:center;position:relative;z-index:1;padding:56px 0 40px}
      .c-eyebrow{font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#A5D6A7;margin-bottom:14px}
      .c-title{font-size:42px;font-weight:800;color:#fff;line-height:1.1;margin-bottom:10px;max-width:640px}
      .c-sub{font-size:15px;color:rgba(255,255,255,.65);margin-bottom:36px}
      .c-meta{display:flex;gap:48px;margin-bottom:36px}
      .c-meta-item label{display:block;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#81C784;margin-bottom:5px}
      .c-meta-item span{font-size:15px;font-weight:600;color:#fff}
      .c-prog-wrap{max-width:480px}
      .c-prog-hd{display:flex;justify-content:space-between;margin-bottom:8px}
      .c-prog-hd span{font-size:12px;color:rgba(255,255,255,.65)}
      .c-prog-hd strong{font-size:15px;font-weight:700;color:#fff}
      .c-prog-bg{height:10px;background:rgba(255,255,255,.2);border-radius:5px;overflow:hidden}
      .c-prog-fill{height:100%;background:linear-gradient(90deg,#A5D6A7,#4CAF50);border-radius:5px}
      .c-bottom{position:relative;z-index:1;border-top:1px solid rgba(255,255,255,.15);padding-top:22px;display:flex;justify-content:space-between;align-items:center}
      .c-bottom-l{font-size:12px;color:rgba(255,255,255,.6)}
      .c-bottom-l strong{color:rgba(255,255,255,.9);display:block;font-size:13px;margin-bottom:2px}
      .c-bottom-r{font-size:11px;color:rgba(255,255,255,.45);text-align:right}

      /* ─── CONTEÚDO ──────────────────────────────────────── */
      .page{padding:48px 52px}
      .sec{margin-bottom:36px}
      .sec-title{
        font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;
        color:#2E7D32;margin-bottom:14px;padding-bottom:8px;
        border-bottom:2px solid #E8F5E9;display:flex;align-items:center;gap:8px
      }

      /* KPI cards */
      .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
      .kpi{background:#F8FFF8;border:1px solid #C8E6C9;border-radius:12px;padding:18px;text-align:center;position:relative;overflow:hidden}
      .kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#1B5E20,#66BB6A)}
      .kpi-v{font-size:22px;font-weight:800;color:#1B5E20;margin-bottom:3px}
      .kpi-l{font-size:10px;color:#757575;font-weight:600;text-transform:uppercase;letter-spacing:.5px}

      /* Barra de progresso geral */
      .prog-card{background:#F8FFF8;border:1px solid #C8E6C9;border-radius:12px;padding:18px;margin-bottom:14px}
      .prog-hd{display:flex;justify-content:space-between;margin-bottom:10px;font-size:12px;font-weight:600;color:#1B5E20}
      .prog-bg{height:10px;background:#E8F5E9;border-radius:5px;overflow:hidden}
      .prog-fill{height:100%;border-radius:5px;background:linear-gradient(90deg,#1B5E20,#66BB6A)}

      /* Tabela EAP */
      .eap-table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #DCEDC8}
      .eap-table thead tr{background:linear-gradient(135deg,#1B5E20,#2E7D32)}
      .eap-table th{padding:10px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#fff}
      .eap-table td{padding:9px 14px;border-bottom:1px solid #F1F8E9;font-size:12px;vertical-align:middle}
      .eap-table tr:last-child td{border-bottom:none}
      /* Linha de objetivo (nível 1) */
      .eap-table tr.obj td{background:#E8F5E9!important;border-top:2px solid #C8E6C9;border-bottom:1px solid #C8E6C9}
      /* Linha de ação (nível 2+) */
      .eap-table tr.act:nth-child(even) td{background:#FAFFFE}

      .badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap}
      .pbar-wrap{display:flex;align-items:center;gap:6px}
      .pbar-bg{width:36px;height:5px;background:#E8F5E9;border-radius:3px;overflow:hidden;flex-shrink:0}
      .pbar-fill{height:100%;border-radius:3px}

      /* Atividades semanais */
      .task-block{margin-bottom:18px;border:1px solid #E8F5E9;border-radius:10px;overflow:hidden}
      .task-block-hd{background:linear-gradient(135deg,#1B5E20,#2E7D32);padding:10px 16px;font-size:12px;font-weight:700;color:#fff}
      .task-block-body{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
      .upd-card{border-radius:8px;overflow:hidden;border:1px solid #E8F5E9}
      .upd-hd{background:#F1F8E9;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;font-size:11px}
      .upd-week{font-weight:700;color:#1B5E20}
      .upd-pct{background:#2E7D32;color:#fff;padding:2px 10px;border-radius:10px;font-size:10px;font-weight:700}
      .upd-body{padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:12px}
      .upd-exec{background:#F8FFF8;border-left:3px solid #2E7D32;border-radius:0 6px 6px 0;padding:8px 10px}
      .upd-block{background:#FFF3E0;border-left:3px solid #E65100;border-radius:0 6px 6px 0;padding:8px 10px}
      .upd-next {background:#E3F2FD;border-left:3px solid #1565C0;border-radius:0 6px 6px 0;padding:8px 10px}
      .upd-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:3px}
      .upd-exec .upd-lbl{color:#1B5E20}
      .upd-block .upd-lbl{color:#E65100}
      .upd-next  .upd-lbl{color:#1565C0}
      .upd-by{font-size:10px;color:#9E9E9E;text-align:right;margin-top:4px}

      /* Riscos */
      .risk-table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #FFCDD2}
      .risk-table thead tr{background:linear-gradient(135deg,#B71C1C,#C62828)}
      .risk-table th{padding:9px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#fff}
      .risk-table td{padding:8px 14px;border-bottom:1px solid #FFEBEE;font-size:12px;vertical-align:middle}
      .risk-table tr:last-child td{border-bottom:none}
      .risk-table tr:nth-child(even) td{background:#FFF8F8}

      /* Rodapé */
      .footer{margin-top:40px;padding-top:16px;border-top:2px solid #E8F5E9;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#9E9E9E}

      /* Botão de impressão (some ao imprimir) */
      .print-btn{position:fixed;bottom:24px;right:24px;background:#2E7D32;color:#fff;border:none;padding:13px 26px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 20px rgba(46,125,50,.35);z-index:9999;display:flex;align-items:center;gap:8px}
      .print-btn:hover{background:#1B5E20}
      @media print{
        .print-btn{display:none!important}
        body{font-size:11px}
        .cover{min-height:auto;padding:40px 48px}
        .eap-table tr.obj td,.eap-table tr.act:nth-child(even) td,.kpi,.prog-card{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      }
    `;

    // ── Monta linhas da EAP ordenadas (com descrição em sub-linha) ──
    const eapRows = tasks.map(t => {
      const isObj = t.eap_level === 1;
      const indent = (t.eap_level - 1) * 18;
      const prog = parseFloat(t.progress || 0).toFixed(0);
      const descRow = t.description ? `
        <tr class="${isObj ? 'obj' : 'act'}" style="border-top:none">
          <td></td>
          <td colspan="6" style="padding-left:${indent + 14}px;padding-top:0;padding-bottom:8px">
            <div style="font-size:10px;color:#666;font-style:italic;border-left:2px solid ${isObj?'#2E7D32':'#A5D6A7'};padding-left:8px;margin-top:2px">${t.description}</div>
          </td>
        </tr>` : '';
      return `<tr class="${isObj ? 'obj' : 'act'}">
        <td style="font-weight:${isObj?700:500};color:${isObj?'#1B5E20':'#2E7D32'};white-space:nowrap;font-size:11px">${t.eap_code || '—'}</td>
        <td style="padding-left:${indent + 14}px;font-weight:${isObj?700:400}">
          ${isObj ? '<strong>' + t.name + '</strong>' : t.name}
        </td>
        <td style="color:#555;white-space:nowrap">${t.assignee_name || '—'}</td>
        <td><span class="badge" style="background:${SC[t.status]||'#9E9E9E'}">${t.status}</span></td>
        <td style="color:#666;white-space:nowrap;font-size:11px">${fmtD(t.start_date)}</td>
        <td style="color:#666;white-space:nowrap;font-size:11px">${fmtD(t.end_date)}</td>
        <td>
          <div class="pbar-wrap">
            <div class="pbar-bg"><div class="pbar-fill" style="width:${prog}%;background:${pColor(t.progress)}"></div></div>
            <span style="font-weight:700;font-size:11px;color:${pColor(t.progress)}">${prog}%</span>
          </div>
        </td>
      </tr>${descRow}`;
    }).join('');

    // ── Atividades semanais agrupadas por Ponto Macro (eap_level === 1) ──
    const tasksWithUpdates = tasks.filter(t => (t._updates||[]).length > 0);

    // Monta agrupamento: para cada atividade semanal, encontra o macro-pai
    function getMacroParent(task, allTasks) {
      if (task.eap_level === 1) return task;
      // eap_code micro ex: "1.1", "2.3" → macro é o primeiro segmento
      if (task.eap_code) {
        const macroCode = String(task.eap_code).split('.')[0];
        const macro = allTasks.find(t => t.eap_level === 1 && String(t.eap_code) === macroCode);
        if (macro) return macro;
      }
      return null;
    }

    // Agrupa tarefas com updates pelo macro pai
    const macroGroups = [];
    const seenMacroIds = new Set();
    // Primeiro, descobrir todos os macros referenciados
    tasksWithUpdates.forEach(t => {
      const macro = getMacroParent(t, tasks);
      const macroId = macro ? macro.id : '__sem_macro__';
      if (!seenMacroIds.has(macroId)) {
        seenMacroIds.add(macroId);
        macroGroups.push({ macro, tasks: [] });
      }
      macroGroups.find(g => (g.macro ? g.macro.id : '__sem_macro__') === macroId).tasks.push(t);
    });

    const actividadesHTML = tasksWithUpdates.length ? `
    <div class="sec">
      <div class="sec-title">📅 Atividades Semanais por Ação</div>
      ${macroGroups.map(group => `
      <div style="margin-bottom:24px">
        ${group.macro ? `
        <div style="background:linear-gradient(135deg,#1B5E20,#388E3C);border-radius:10px 10px 0 0;padding:10px 16px;margin-bottom:0">
          <div style="font-size:11px;font-weight:800;color:#fff;letter-spacing:.5px">
            📌 Ponto Macro ${group.macro.eap_code || ''} — ${group.macro.name}
          </div>
          ${group.macro.description ? `<div style="font-size:10px;color:rgba(255,255,255,.75);margin-top:4px;font-style:italic">${group.macro.description}</div>` : ''}
        </div>` : `
        <div style="background:#546E7A;border-radius:10px 10px 0 0;padding:10px 16px;margin-bottom:0">
          <div style="font-size:11px;font-weight:800;color:#fff">📌 Ações sem vínculo de ponto macro</div>
        </div>`}
        <div style="border:1px solid #C8E6C9;border-top:none;border-radius:0 0 10px 10px;padding:12px;display:flex;flex-direction:column;gap:12px">
          ${group.tasks.map(t => `
          <div class="task-block" style="margin-bottom:0">
            <div class="task-block-hd" style="background:linear-gradient(135deg,#2E7D32,#43A047)">
              ${t.eap_code ? '[' + t.eap_code + '] ' : ''}${t.name}
              ${t.description ? '<div style="font-size:10px;font-weight:400;color:rgba(255,255,255,.8);margin-top:3px;font-style:italic">' + t.description + '</div>' : ''}
            </div>
            <div class="task-block-body">
              ${t._updates.map(u => `
              <div class="upd-card">
                <div class="upd-hd">
                  <span class="upd-week">📅 Semana de ${fmtD(u.week_ref)}</span>
                  ${u.progress != null ? '<span class="upd-pct">' + parseFloat(u.progress).toFixed(0) + '% concluído</span>' : ''}
                </div>
                <div class="upd-body">
                  <div class="upd-exec"><div class="upd-lbl">✅ Executado</div>${u.executed}</div>
                  ${u.blockers ? '<div class="upd-block"><div class="upd-lbl">🚧 Bloqueio</div>' + u.blockers + '</div>' : ''}
                  ${u.next_steps ? '<div class="upd-next"><div class="upd-lbl">🎯 Próximas atividades</div>' + u.next_steps + '</div>' : ''}
                  <div class="upd-by">👤 ${u.user_name || '—'}</div>
                </div>
              </div>`).join('')}
            </div>
          </div>`).join('')}
        </div>
      </div>`).join('')}
    </div>` : '';

    // ── Riscos ──
    const riscosHTML = (p.risks||[]).length ? `
    <div class="sec">
      <div class="sec-title">⚠️ Gestão de Riscos — ${p.risks.length} registro(s)</div>
      <table class="risk-table">
        <thead><tr>
          <th style="width:70px">Código</th><th>Descrição</th>
          <th style="width:55px;text-align:center">Prob.</th>
          <th style="width:65px;text-align:center">Impacto</th>
          <th style="width:75px;text-align:center">Severidade</th>
          <th style="width:90px">Status</th><th>Mitigação</th>
        </tr></thead>
        <tbody>${p.risks.map(r => {
          const sev = r.probability * r.impact;
          const sc  = sev >= 15 ? '#C62828' : sev >= 9 ? '#E65100' : '#2E7D32';
          return `<tr>
            <td style="font-weight:700;font-size:11px">${r.code||'—'}</td>
            <td>${r.description}</td>
            <td style="text-align:center">${r.probability}</td>
            <td style="text-align:center">${r.impact}</td>
            <td style="text-align:center;font-weight:700;color:${sc}">${sev}</td>
            <td><span class="badge" style="background:${r.status==='Ativo'?'#C62828':'#2E7D32'}">${r.status}</span></td>
            <td style="font-size:11px;color:#555">${r.mitigation||'—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório — ${p.name}</title>
<style>${css}</style>
</head><body>

<!-- CAPA -->
<div class="cover">
  <div class="c-top">
    <div class="c-logo">PMO<span>Suite</span></div>
    <div class="c-badge">Relatório Executivo</div>
  </div>
  <div class="c-mid">
    <div class="c-eyebrow">Plano de Ação — ${p.area || 'Departamento'}</div>
    <div class="c-title">${p.name}</div>
    <div class="c-sub">Código: <strong style="color:#fff">${p.code}</strong> &nbsp;·&nbsp; Gestor: ${p.manager_name || '—'}</div>
    <div class="c-meta">
      <div class="c-meta-item"><label>Início</label><span>${fmtD(p.start_date)}</span></div>
      <div class="c-meta-item"><label>Término</label><span>${fmtD(p.end_date)}</span></div>
      <div class="c-meta-item"><label>Status</label><span>${p.status}</span></div>
      <div class="c-meta-item"><label>Prioridade</label><span>${p.priority || '—'}</span></div>
    </div>
    <div class="c-prog-wrap">
      <div class="c-prog-hd"><span>Progresso geral</span><strong>${parseFloat(p.progress||0).toFixed(1)}%</strong></div>
      <div class="c-prog-bg"><div class="c-prog-fill" style="width:${p.progress||0}%"></div></div>
    </div>
  </div>
  <div class="c-bottom">
    <div class="c-bottom-l">
      <strong>Gerado por: ${user.name || '—'}</strong>
      ${user.active_department ? user.active_department + ' · ' : ''}${nowStr}
    </div>
    <div class="c-bottom-r">PMO Suite v5.0<br>Uso interno — confidencial</div>
  </div>
</div>

<!-- CONTEÚDO -->
<div class="page">

  <!-- KPIs -->
  <div class="sec">
    <div class="sec-title">📊 Indicadores do Projeto</div>
    <div class="kpi-row">
      <div class="kpi">
        <div class="kpi-v" style="color:${pColor(p.progress)}">${parseFloat(p.progress||0).toFixed(1)}%</div>
        <div class="kpi-l">Progresso Geral</div>
      </div>
      <div class="kpi">
        <div class="kpi-v">${tasks.length}</div>
        <div class="kpi-l">Total de Ações</div>
      </div>
      <div class="kpi">
        <div class="kpi-v" style="color:#2E7D32">${tasks.filter(t=>t.status==='Concluído').length}</div>
        <div class="kpi-l">Concluídas</div>
      </div>
      <div class="kpi">
        <div class="kpi-v" style="color:${(p.risks||[]).filter(r=>r.status==='Ativo').length>0?'#C62828':'#2E7D32'}">${(p.risks||[]).filter(r=>r.status==='Ativo').length}</div>
        <div class="kpi-l">Riscos Ativos</div>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-v" style="font-size:16px">${fmtR(p.budget)}</div><div class="kpi-l">Orçamento Previsto</div></div>
      <div class="kpi"><div class="kpi-v" style="font-size:16px;color:${parseFloat(p.actual_cost)>parseFloat(p.budget)?'#C62828':'#2E7D32'}">${fmtR(p.actual_cost)}</div><div class="kpi-l">Custo Realizado</div></div>
      <div class="kpi"><div class="kpi-v" style="font-size:16px">${fmtD(p.start_date)}</div><div class="kpi-l">Data de Início</div></div>
      <div class="kpi"><div class="kpi-v" style="font-size:16px">${fmtD(p.end_date)}</div><div class="kpi-l">Data de Término</div></div>
    </div>
    <div class="prog-card">
      <div class="prog-hd"><span>Evolução do Progresso</span><span>${parseFloat(p.progress||0).toFixed(1)}% concluído</span></div>
      <div class="prog-bg"><div class="prog-fill" style="width:${p.progress||0}%"></div></div>
    </div>
  </div>

  <!-- EAP ORDENADA -->
  <div class="sec">
    <div class="sec-title">${isAnual ? '⭐ Projetos Anuais' : '📋 Estrutura EAP'} — ${tasks.length} item(s)</div>
    <table class="eap-table">
      <thead><tr>
        <th style="width:72px">Cód. EAP</th>
        <th>Ação / Entregável</th>
        <th style="width:130px">Responsável</th>
        <th style="width:110px">Status</th>
        <th style="width:88px">Início</th>
        <th style="width:88px">Término</th>
        <th style="width:72px">%</th>
      </tr></thead>
      <tbody>${eapRows}</tbody>
    </table>
  </div>

  ${(() => {
    // Separação trimestral das tarefas dentro do projeto
    const projYear = (() => {
      const ed = parseDateR(p.end_date);
      if (ed) return ed.getFullYear();
      // fallback: ano mais frequente nas tarefas
      const ys = tasks.map(t => { const d = parseDateR(t.end_date); return d ? d.getFullYear() : null; }).filter(Boolean);
      const yc = {}; ys.forEach(y => yc[y]=(yc[y]||0)+1);
      return Object.keys(yc).sort((a,b)=>yc[b]-yc[a])[0] || new Date().getFullYear();
    })();

    const triSecs = trimestresR.map(tri => {
      const triTasks = tasks.filter(t => {
        const ed = parseDateR(t.end_date);
        return ed && ed.getFullYear() === parseInt(projYear) && tri.months.includes(ed.getMonth()+1);
      });
      if (!triTasks.length) return '';
      return `
        <div style="margin-bottom:16px">
          <div style="background:linear-gradient(135deg,#1B5E20,#388E3C);border-radius:8px 8px 0 0;padding:8px 14px">
            <span style="font-size:11px;font-weight:700;color:#fff">📅 ${tri.label} ${projYear} — ${triTasks.length} ação(ões)</span>
          </div>
          <div style="border:1px solid #C8E6C9;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              ${triTasks.map((t,i) => {
                const prog = parseFloat(t.progress||0).toFixed(0);
                const isObj = t.eap_level === 1;
                return `<tr style="background:${i%2===0?'#F8FFF8':'#fff'};border-bottom:1px solid #F1F8E9">
                  <td style="padding:7px 12px;width:60px;font-size:10px;font-weight:700;color:${isObj?'#1B5E20':'#2E7D32'}">${t.eap_code||'—'}</td>
                  <td style="padding:7px 12px;font-size:11px;font-weight:${isObj?700:400}">${t.name}</td>
                  <td style="padding:7px 12px;width:100px"><span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;color:#fff;background:${SC[t.status]||'#9E9E9E'}">${t.status}</span></td>
                  <td style="padding:7px 12px;width:76px;font-size:10px;color:#666">${fmtD(t.end_date)}</td>
                  <td style="padding:7px 12px;width:56px;font-size:11px;font-weight:700;color:${pColor(t.progress)};text-align:right">${prog}%</td>
                </tr>`;
              }).join('')}
            </table>
          </div>
        </div>`;
    }).join('');

    if (!triSecs) return '';
    return `
    <div class="sec">
      <div class="sec-title">📅 Separação Trimestral ${projYear}</div>
      ${triSecs}
    </div>`;
  })()}

  ${actividadesHTML}
  ${riscosHTML}

  ${(p.objective||p.scope_in||p.scope_out) ? `
  <div class="sec">
    <div class="sec-title">📌 Informações Adicionais</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${p.objective?`<div style="background:#F8FFF8;border:1px solid #C8E6C9;border-radius:10px;padding:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#2E7D32;margin-bottom:6px">Objetivo</div><div style="font-size:12px">${p.objective}</div></div>`:''}
      ${p.scope_in?`<div style="background:#F8FFF8;border:1px solid #C8E6C9;border-radius:10px;padding:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#2E7D32;margin-bottom:6px">Escopo (dentro)</div><div style="font-size:12px">${p.scope_in}</div></div>`:''}
      ${p.scope_out?`<div style="background:#FFF8F8;border:1px solid #FFCDD2;border-radius:10px;padding:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#C62828;margin-bottom:6px">Escopo (fora)</div><div style="font-size:12px">${p.scope_out}</div></div>`:''}
      ${p.success_criteria?`<div style="background:#F8FFF8;border:1px solid #C8E6C9;border-radius:10px;padding:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#2E7D32;margin-bottom:6px">Critérios de Sucesso</div><div style="font-size:12px">${p.success_criteria}</div></div>`:''}
    </div>
  </div>` : ''}

  <div class="footer">
    <div><strong>PMO Suite v5.0</strong> · Gerado em ${nowStr} · ${user.name||'—'} ${user.active_department ? '· ' + user.active_department : ''}</div>
    <div>${p.name} — ${p.code} · Uso interno · Confidencial</div>
  </div>

</div><!-- /page -->

<button class="print-btn" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
</body></html>`;

    win.document.write(html);
    win.document.close();
  } catch(err) { toast('Erro ao gerar relatório: ' + err.message, 'error'); }
}


/* ═══════════════════════════════════════════════════════════
   EXPORTAÇÃO CONSOLIDADA POR ÁREA (diretoria)
═══════════════════════════════════════════════════════════ */
async function exportByArea() {
  try {
    const [areas, allProjects] = await Promise.all([
      GET('/dashboard/by-area'),
      GET('/projects')
    ]);
    const user  = Auth.user || {};
    const win   = window.open('', '_blank', 'width=1200,height=800');
    const fmtR  = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
    const now   = new Date();
    const nowStr = now.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    const totalProjects = areas.reduce((s,a) => s + parseInt(a.total||0), 0);
    const totalDelayed  = areas.reduce((s,a) => s + parseInt(a.delayed||0), 0);
    const totalDone     = areas.reduce((s,a) => s + parseInt(a.done||0), 0);
    const totalBudget   = areas.reduce((s,a) => s + parseFloat(a.total_budget||0), 0);
    const totalCost     = areas.reduce((s,a) => s + parseFloat(a.total_cost||0), 0);
    const avgProgress   = areas.length
      ? (areas.reduce((s,a) => s + parseFloat(a.avg_progress||0), 0) / areas.length).toFixed(1)
      : 0;

    const css = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Inter',sans-serif;font-size:12px;color:#212121;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}

      .cover{
        width:100%;min-height:100vh;
        background:linear-gradient(145deg,#1B5E20 0%,#2E7D32 45%,#388E3C 75%,#1B3A1B 100%);
        display:flex;flex-direction:column;justify-content:space-between;
        padding:56px 64px;page-break-after:always;position:relative;overflow:hidden
      }
      .cover::before{content:'';position:absolute;top:-100px;right:-100px;width:500px;height:500px;border-radius:50%;background:rgba(255,255,255,.035)}
      .c-top{display:flex;justify-content:space-between;align-items:flex-start;position:relative;z-index:1}
      .c-logo{font-size:24px;font-weight:800;color:#fff;letter-spacing:-.5px}
      .c-logo span{color:#A5D6A7}
      .c-badge{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;padding:7px 18px;border-radius:20px;font-size:12px;font-weight:500}
      .c-mid{flex:1;display:flex;flex-direction:column;justify-content:center;position:relative;z-index:1;padding:56px 0 40px}
      .c-eyebrow{font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#A5D6A7;margin-bottom:14px}
      .c-title{font-size:42px;font-weight:800;color:#fff;line-height:1.1;margin-bottom:10px}
      .c-sub{font-size:15px;color:rgba(255,255,255,.65);margin-bottom:40px}
      .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
      .summary-item{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:22px;text-align:center}
      .summary-val{font-size:30px;font-weight:800;color:#fff;margin-bottom:5px}
      .summary-lbl{font-size:11px;color:rgba(255,255,255,.7);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
      .c-bottom{position:relative;z-index:1;border-top:1px solid rgba(255,255,255,.15);padding-top:22px;display:flex;justify-content:space-between;align-items:center}
      .c-bottom-l{font-size:12px;color:rgba(255,255,255,.6)}
      .c-bottom-l strong{color:rgba(255,255,255,.9);display:block;font-size:13px;margin-bottom:2px}
      .c-bottom-r{font-size:11px;color:rgba(255,255,255,.45);text-align:right}

      .page{padding:48px 52px}
      .sec-title{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2E7D32;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #E8F5E9}

      table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #DCEDC8}
      thead tr{background:linear-gradient(135deg,#1B5E20,#2E7D32)}
      th{padding:11px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#fff}
      td{padding:10px 14px;border-bottom:1px solid #F1F8E9;font-size:12px;vertical-align:middle}
      tr:last-child td{border-bottom:none}
      tr:nth-child(even) td{background:#FAFFFE}
      tr.total-row td{background:#E8F5E9!important;font-weight:700;border-top:2px solid #C8E6C9}

      .pbar-wrap{display:flex;align-items:center;gap:8px}
      .pbar-bg{background:#E8F5E9;border-radius:4px;height:7px;overflow:hidden;width:70px;flex-shrink:0}
      .pbar-fill{background:linear-gradient(90deg,#1B5E20,#66BB6A);height:100%;border-radius:4px}

      .footer{margin-top:32px;padding-top:16px;border-top:2px solid #E8F5E9;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#9E9E9E}

      .print-btn{position:fixed;bottom:24px;right:24px;background:#2E7D32;color:#fff;border:none;padding:13px 26px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 20px rgba(46,125,50,.35);z-index:9999}
      .print-btn:hover{background:#1B5E20}
      @media print{.print-btn{display:none!important}body{font-size:11px}.cover{min-height:auto;padding:40px 48px}}
    `;

    const rows = areas.map(a => `<tr>
      <td style="font-weight:700;font-size:13px">${a.area || '—'}</td>
      <td style="text-align:center">${a.total}</td>
      <td style="text-align:center;color:#1565C0;font-weight:600">${a.active}</td>
      <td style="text-align:center;font-weight:${a.delayed>0?700:400};color:${a.delayed>0?'#C62828':'#2E7D32'}">${a.delayed}</td>
      <td style="text-align:center;color:#2E7D32;font-weight:600">${a.done}</td>
      <td>
        <div class="pbar-wrap">
          <div class="pbar-bg"><div class="pbar-fill" style="width:${a.avg_progress||0}%"></div></div>
          <span style="font-weight:700;font-size:12px">${parseFloat(a.avg_progress||0).toFixed(1)}%</span>
        </div>
      </td>
      <td style="white-space:nowrap">${fmtR(a.total_budget)}</td>
      <td style="white-space:nowrap;color:${parseFloat(a.total_cost)>parseFloat(a.total_budget)?'#C62828':'#2E7D32'}">${fmtR(a.total_cost)}</td>
      <td style="text-align:center">${a.open_tasks}</td>
      <td style="text-align:center;font-weight:${a.active_risks>0?700:400};color:${a.active_risks>0?'#C62828':'inherit'}">${a.active_risks}</td>
    </tr>`).join('');

    // ── Helpers de data ──
    const fmtDBA = v => {
      if (!v) return '—';
      const s = String(v).replace(' ','T').split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d]=s.split('-'); return d+'/'+m+'/'+y; }
      return s;
    };
    const parseDate = v => {
      if (!v) return null;
      const s = String(v).replace(' ','T').split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d,m,y]=s.split('/'); return new Date(`${y}-${m}-${d}T00:00:00`); }
      return null;
    };
    const SC_BA = {
      'Em andamento':'#1565C0','Concluído':'#2E7D32','Atrasado':'#C62828',
      'Planejado':'#546E7A','Em espera':'#6A1B9A','Cancelado':'#37474F'
    };
    const badgeBA = s => `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;color:#fff;background:${SC_BA[s]||'#9E9E9E'}">${s}</span>`;
    const pColorBA = v => { const n=parseFloat(v||0); return n>=80?'#2E7D32':n>=40?'#E65100':'#C62828'; };

    const projCard = p => `
      <div style="border:1px solid #C8E6C9;border-radius:10px;padding:14px;background:#F8FFF8;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div>
            <div style="font-size:13px;font-weight:700;color:#1B5E20">${p.name}</div>
            <div style="font-size:10px;color:#757575;margin-top:2px">${p.code} · ${p.area||'—'} · Gestor: ${typeof p.manager_name==='object'?p.manager_name?.name||'—':p.manager_name||'—'}</div>
            ${p.description ? `<div style="font-size:11px;color:#555;font-style:italic;margin-top:4px;border-left:2px solid #2E7D32;padding-left:8px">${p.description}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${badgeBA(p.status)}
            <div style="font-size:11px;font-weight:700;color:${pColorBA(p.progress)};margin-top:4px">${parseFloat(p.progress||0).toFixed(0)}%</div>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;gap:16px;font-size:10px;color:#666">
          <span>📅 Início: ${fmtDBA(p.start_date)}</span>
          <span>🏁 Término: ${fmtDBA(p.end_date)}</span>
          <span>💰 ${fmtR(p.budget)}</span>
        </div>
      </div>`;

    // ── PROJETOS ANUAIS (end_date >= 01/04/2027) ──
    const ANUAL_CUTOFF = new Date('2027-04-01T00:00:00');
    const projetosAnuais = (allProjects||[]).filter(p => {
      const ed = parseDate(p.end_date);
      return ed && ed >= ANUAL_CUTOFF;
    });
    const anuaisHTML = projetosAnuais.length ? `
    <div style="margin-bottom:36px">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2E7D32;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #E8F5E9">
        📆 Projetos Anuais — término a partir de 01/04/2027 (${projetosAnuais.length} projeto(s))
      </div>
      ${projetosAnuais.map(projCard).join('')}
    </div>` : '';

    // ── SEPARAÇÃO TRIMESTRAL ──
    const trimestres = [
      { label: '1º Trimestre', months: [1,2,3] },
      { label: '2º Trimestre', months: [4,5,6] },
      { label: '3º Trimestre', months: [7,8,9] },
      { label: '4º Trimestre', months: [10,11,12] },
    ];
    // Usa o ano com mais projetos, ou ano corrente
    const years = (allProjects||[]).map(p => { const d=parseDate(p.end_date); return d?d.getFullYear():null; }).filter(Boolean);
    const yearCount = {};
    years.forEach(y => yearCount[y]=(yearCount[y]||0)+1);
    const refYear = Object.keys(yearCount).sort((a,b)=>yearCount[b]-yearCount[a])[0] || new Date().getFullYear();

    const trimestralHTML = trimestres.map(tri => {
      const projsTri = (allProjects||[]).filter(p => {
        const ed = parseDate(p.end_date);
        return ed && ed.getFullYear() === parseInt(refYear) && tri.months.includes(ed.getMonth()+1);
      });
      return `
      <div style="margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#1B5E20,#388E3C);border-radius:10px 10px 0 0;padding:10px 16px">
          <div style="font-size:12px;font-weight:700;color:#fff">📅 ${tri.label} ${refYear} — ${projsTri.length} projeto(s)</div>
        </div>
        <div style="border:1px solid #C8E6C9;border-top:none;border-radius:0 0 10px 10px;padding:12px">
          ${projsTri.length ? projsTri.map(projCard).join('') : '<div style="font-size:12px;color:#9E9E9E;padding:8px">Nenhum projeto com término neste trimestre.</div>'}
        </div>
      </div>`;
    }).join('');

    const separacaoHTML = `
    <div style="margin-bottom:36px">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2E7D32;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #E8F5E9">
        📊 Separação Trimestral — ${refYear}
      </div>
      ${trimestralHTML}
    </div>`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório Consolidado — PMO</title>
<style>${css}</style>
</head><body>

<div class="cover">
  <div class="c-top">
    <div class="c-logo">PMO<span>Suite</span></div>
    <div class="c-badge">Relatório da Diretoria</div>
  </div>
  <div class="c-mid">
    <div class="c-eyebrow">Visão Consolidada do Portfólio</div>
    <div class="c-title">Relatório por<br>Área / Departamento</div>
    <div class="c-sub">Situação atual de todos os projetos e departamentos</div>
    <div class="summary-grid">
      <div class="summary-item"><div class="summary-val">${totalProjects}</div><div class="summary-lbl">Total de Projetos</div></div>
      <div class="summary-item"><div class="summary-val">${areas.length}</div><div class="summary-lbl">Departamentos</div></div>
      <div class="summary-item"><div class="summary-val" style="color:${totalDelayed>0?'#FFCDD2':'#A5D6A7'}">${totalDelayed}</div><div class="summary-lbl">Projetos Atrasados</div></div>
      <div class="summary-item"><div class="summary-val">${totalDone}</div><div class="summary-lbl">Concluídos</div></div>
    </div>
  </div>
  <div class="c-bottom">
    <div class="c-bottom-l"><strong>Gerado por: ${user.name||'—'}</strong>${nowStr}</div>
    <div class="c-bottom-r">PMO Suite v5.0<br>Uso interno — confidencial</div>
  </div>
</div>

<div class="page">
  <div class="sec-title">📊 Resumo por Área / Departamento</div>
  <table>
    <thead><tr>
      <th>Área / Departamento</th>
      <th style="text-align:center">Total</th>
      <th style="text-align:center">Ativos</th>
      <th style="text-align:center">Atrasados</th>
      <th style="text-align:center">Concluídos</th>
      <th style="min-width:120px">Progresso Médio</th>
      <th>Orçamento</th>
      <th>Realizado</th>
      <th style="text-align:center">T. Abertas</th>
      <th style="text-align:center">Riscos</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td>TOTAL GERAL</td>
        <td style="text-align:center">${totalProjects}</td>
        <td style="text-align:center">${areas.reduce((s,a)=>s+parseInt(a.active||0),0)}</td>
        <td style="text-align:center;color:${totalDelayed>0?'#C62828':'#2E7D32'}">${totalDelayed}</td>
        <td style="text-align:center">${totalDone}</td>
        <td>
          <div class="pbar-wrap">
            <div class="pbar-bg"><div class="pbar-fill" style="width:${avgProgress}%"></div></div>
            <span style="font-weight:700">${avgProgress}%</span>
          </div>
        </td>
        <td>${fmtR(totalBudget)}</td>
        <td style="color:${totalCost>totalBudget?'#C62828':'#2E7D32'}">${fmtR(totalCost)}</td>
        <td style="text-align:center">${areas.reduce((s,a)=>s+parseInt(a.open_tasks||0),0)}</td>
        <td style="text-align:center">${areas.reduce((s,a)=>s+parseInt(a.active_risks||0),0)}</td>
      </tr>
    </tbody>
  </table>

  ${anuaisHTML}
  ${separacaoHTML}

  <div class="footer">
    <div>PMO Suite v5.0 · Gerado em ${nowStr} · Por: ${user.name||'—'}</div>
    <div>Documento confidencial — Uso interno</div>
  </div>
</div>

<button class="print-btn" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
</body></html>`;

    win.document.write(html);
    win.document.close();
  } catch(err) { toast('Erro: ' + err.message, 'error'); }
}


/* ═══════════════════════════════════════════════════════════
   TROCA DE SENHA OBRIGATÓRIA (primeiro acesso)
═══════════════════════════════════════════════════════════ */
function showForcePasswordChange() {
  let overlay = document.getElementById('force-pwd-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'force-pwd-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = '';
  const card = document.createElement('div');
  card.style.cssText = 'background:var(--card);border-radius:16px;width:100%;max-width:420px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.4)';

  // Header verde
  const header = document.createElement('div');
  header.style.cssText = 'background:linear-gradient(135deg,#1B5E20,#2E7D32);padding:28px;';
  header.innerHTML = '<div style="font-size:32px;margin-bottom:10px">🔒</div><div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:6px">Defina sua senha pessoal</div><div style="font-size:13px;color:rgba(255,255,255,.8)">Primeiro acesso detectado. Crie uma senha pessoal antes de continuar.</div>';
  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'padding:24px;display:flex;flex-direction:column;gap:16px';

  const fields = [
    { id: 'fpwd-current',  label: 'Senha atual (padrão: Safra@2027)', placeholder: 'Safra@2027', value: 'Safra@2027' },
    { id: 'fpwd-new',      label: 'Nova senha (mínimo 6 caracteres)',  placeholder: 'Sua nova senha', value: '' },
    { id: 'fpwd-confirm',  label: 'Confirmar nova senha',               placeholder: 'Repita a nova senha', value: '' },
  ];

  fields.forEach(f => {
    const wrap = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px';
    lbl.textContent = f.label;
    const inp = document.createElement('input');
    inp.type = 'password';
    inp.id = f.id;
    inp.placeholder = f.placeholder;
    inp.value = f.value;
    inp.style.cssText = 'width:100%;padding:11px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;background:var(--subtle);color:var(--text);outline:none';
    inp.addEventListener('focus', () => inp.style.borderColor = '#2E7D32');
    inp.addEventListener('blur',  () => inp.style.borderColor = 'var(--border)');
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    body.appendChild(wrap);
  });

  const errDiv = document.createElement('div');
  errDiv.id = 'fpwd-error';
  errDiv.style.cssText = 'display:none;background:#FFEBEE;border:1px solid #FFCDD2;border-radius:8px;padding:10px 14px;font-size:13px;color:#C62828';
  body.appendChild(errDiv);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '✓ Definir senha e continuar';
  btn.style.cssText = 'width:100%;padding:13px;background:#2E7D32;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px';
  btn.addEventListener('click', submitForcePassword);
  body.appendChild(btn);

  card.appendChild(body);
  overlay.appendChild(card);
  overlay.style.display = 'flex';
}

async function submitForcePassword() {
  const current = document.getElementById('fpwd-current').value;
  const novo    = document.getElementById('fpwd-new').value;
  const confirm = document.getElementById('fpwd-confirm').value;
  const errDiv  = document.getElementById('fpwd-error');
  const showErr = msg => { if(errDiv){ errDiv.textContent='❌ '+msg; errDiv.style.display='block'; } else toast(msg,'error'); };
  if (!novo || novo.length < 6) { showErr('Nova senha precisa ter ao menos 6 caracteres'); return; }
  if (novo !== confirm) { showErr('As senhas não coincidem'); return; }
  try {
    await PUT('/auth/me/password', { current, newPassword: novo });
    document.getElementById('force-pwd-overlay').style.display = 'none';
    toast('Senha definida! Bem-vindo(a) ao PMO Suite.', 'success');
  } catch(err) { showErr(err.message || 'Erro ao alterar senha'); }
}


/* ═══════════════════════════════════════════════════════════
   ATIVIDADES SEMANAIS POR TAREFA
═══════════════════════════════════════════════════════════ */

// Alterna entre tabs do modal de atividades
function tuTab(tab) {
  const pNew  = document.getElementById('tu-pane-new');
  const pHist = document.getElementById('tu-pane-hist');
  const tNew  = document.getElementById('tu-tab-new');
  const tHist = document.getElementById('tu-tab-hist');
  if (tab === 'new') {
    if (pNew)  pNew.style.display  = 'block';
    if (pHist) pHist.style.display = 'none';
    if (tNew)  { tNew.style.color  = 'var(--g700)'; tNew.style.borderBottomColor  = 'var(--g600)'; tNew.style.fontWeight  = '600'; }
    if (tHist) { tHist.style.color = 'var(--text2)'; tHist.style.borderBottomColor = 'transparent'; tHist.style.fontWeight = '500'; }
  } else {
    if (pNew)  pNew.style.display  = 'none';
    if (pHist) pHist.style.display = 'block';
    if (tHist) { tHist.style.color = 'var(--g700)'; tHist.style.borderBottomColor = 'var(--g600)'; tHist.style.fontWeight = '600'; }
    if (tNew)  { tNew.style.color  = 'var(--text2)'; tNew.style.borderBottomColor  = 'transparent'; tNew.style.fontWeight  = '500'; }
  }
}

async function openTaskUpdates(taskId, btnOrName) {
  const taskName = typeof btnOrName === 'string' ? btnOrName : btnOrName?.dataset?.name || 'Tarefa';
  set$('task-update-name', taskName);
  document.getElementById('task-update-id').value = taskId;

  // Reset form
  document.getElementById('task-update-form').reset();
  document.getElementById('task-update-id').value = taskId;
  document.getElementById('tu-week').value = new Date().toISOString().slice(0, 10);
  const range = document.getElementById('tu-progress-range');
  if (range) { range.value = 0; range.style.background = ''; }
  const val = document.getElementById('tu-progress-val');
  if (val) val.textContent = '0%';
  const hidden = document.getElementById('tu-progress');
  if (hidden) hidden.value = 0;

  // Começa na aba nova atividade
  tuTab('new');
  openModal('modal-task-updates');

  // Carrega histórico em paralelo
  loadTaskUpdates(taskId);
}

async function loadTaskUpdates(taskId) {
  const list = document.getElementById('task-updates-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:40px 0"><div style="font-size:24px;margin-bottom:8px">⏳</div>Carregando histórico…</div>';
  try {
    const updates = await GET('/tasks/' + taskId + '/updates');
    if (!updates.length) {
      list.innerHTML = '<div style="text-align:center;color:var(--text3);font-size:13px;padding:48px 20px"><div style="font-size:36px;margin-bottom:12px">📭</div><div style="font-weight:600;margin-bottom:6px">Nenhuma atividade ainda</div><div>Registre a primeira atividade na aba "Nova Atividade"</div></div>';
      return;
    }
    list.innerHTML = updates.map((u, idx) => {
      const prog = u.progress != null ? parseFloat(u.progress).toFixed(0) : null;
      const progColor = prog >= 80 ? '#2E7D32' : prog >= 40 ? '#E65100' : '#C62828';
      return '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.06)">' +
        // Header
        '<div style="background:linear-gradient(135deg,#1B5E20,#2E7D32);padding:12px 16px;display:flex;justify-content:space-between;align-items:center">' +
          '<div style="font-size:12px;font-weight:700;color:#fff">📅 Semana de ' + _fmtWeek(u.week_ref) + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            (prog != null ? '<span style="background:rgba(255,255,255,.2);color:#fff;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700">' + prog + '%</span>' : '') +
            '<button onclick="deleteTaskUpdate(' + u.task_id + ',' + u.id + ')" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:12px" title="Remover">✕</button>' +
          '</div>' +
        '</div>' +
        // Body
        '<div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">' +
          // Progresso visual
          (prog != null ? '<div style="background:var(--subtle);border-radius:8px;overflow:hidden;height:6px"><div style="height:100%;width:' + prog + '%;background:linear-gradient(90deg,' + progColor + ',#66BB6A);border-radius:8px"></div></div>' : '') +
          // Executado
          '<div style="background:#F1F8E9;border-left:3px solid #2E7D32;border-radius:0 8px 8px 0;padding:10px 12px">' +
            '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#2E7D32;margin-bottom:4px">✅ Executado</div>' +
            '<div style="font-size:13px;color:var(--text)">' + u.executed + '</div>' +
          '</div>' +
          // Bloqueios
          (u.blockers ? '<div style="background:#FFF3E0;border-left:3px solid #E65100;border-radius:0 8px 8px 0;padding:10px 12px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#E65100;margin-bottom:4px">🚧 Bloqueio</div><div style="font-size:13px;color:var(--text)">' + u.blockers + '</div></div>' : '') +
          // Próximos
          (u.next_steps ? '<div style="background:#E3F2FD;border-left:3px solid #1565C0;border-radius:0 8px 8px 0;padding:10px 12px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1565C0;margin-bottom:4px">🎯 Próximas atividades</div><div style="font-size:13px;color:var(--text)">' + u.next_steps + '</div></div>' : '') +
          // Footer
          '<div style="font-size:11px;color:var(--text3);display:flex;justify-content:space-between">' +
            '<span>👤 ' + (u.user_name || '—') + '</span>' +
            '<span>' + new Date(u.created_at || '').toLocaleString('pt-BR') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="color:var(--danger);font-size:13px;padding:16px;text-align:center">❌ Erro: ' + e.message + '</div>';
  }
}

async function saveTaskUpdate(e) {
  e.preventDefault();
  const taskId = document.getElementById('task-update-id').value;
  const body = {
    week_ref:   document.getElementById('tu-week').value,
    executed:   document.getElementById('tu-executed').value,
    progress:   document.getElementById('tu-progress').value || null,
    blockers:   document.getElementById('tu-blockers').value || null,
    next_steps: document.getElementById('tu-next-steps').value || null,
  };
  try {
    await POST('/tasks/' + taskId + '/updates', body);
    toast('Atividade registrada!', 'success');
    // Reset campos mantendo taskId e data
    document.getElementById('tu-executed').value = '';
    document.getElementById('tu-blockers').value = '';
    document.getElementById('tu-next-steps').value = '';
    document.getElementById('tu-progress-range').value = 0;
    document.getElementById('tu-progress-val').textContent = '0%';
    document.getElementById('tu-progress').value = 0;
    await loadTaskUpdates(taskId);
    loadDashboard(); // atualiza KPIs
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTaskUpdate(taskId, updateId) {
  if (!confirm('Remover esta atividade?')) return;
  try {
    await fetch(API + '/tasks/' + taskId + '/updates/' + updateId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + Auth.token }
    });
    toast('Removido', 'info');
    await loadTaskUpdates(taskId);
  } catch (err) { toast(err.message, 'error'); }
}

function _fmtWeek(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ═════════════════════════ INIT ═════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  Chart.defaults.color='#616161'; Chart.defaults.borderColor='#E0E0E0';
  Chart.defaults.font.family="'Inter',sans-serif";

  // Check OAuth callback
  (async function(){
    const p   = new URLSearchParams(location.search);
    const auth = p.get('auth');
    const err  = p.get('auth_error');
    if (err) { history.replaceState({},'','/'); setTimeout(()=>toast(decodeURIComponent(err),'error'),500); showAuth(); return; }

    // Callback do Google OAuth via Supabase
    if (auth === 'google' || location.hash.includes('access_token')) {
      history.replaceState({}, '', '/');
      await _handleGoogleCallback();
      return;
    }

    if (Auth.token) showApp(); else showAuth();
  })();
});
