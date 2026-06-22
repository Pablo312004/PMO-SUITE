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

    // Calcula byPrio a partir dos projetos retornados
    const allProjects = await GET('/projects' + qs).catch(() => []);
    const prioMap = {};
    (allProjects || []).forEach(p => { prioMap[p.priority] = (prioMap[p.priority]||0)+1; });
    const byPrio = Object.entries(prioMap).map(([priority, count]) => ({ priority, count }));

    // Financial a partir dos projetos
    const financial = (allProjects || []).slice(0,8).map(p => ({
      code: p.code, budget: parseFloat(p.budget||0), actual_cost: parseFloat(p.actual_cost||0)
    }));

    // Evolution: progresso semanal dos últimos 8 projetos atualiz.
    const evolution = (allProjects || [])
      .filter(p => p.progress > 0)
      .slice(0,8)
      .map(p => ({
        week: p.code,
        avg_actual: parseFloat(p.progress||0),
        avg_planned: Math.min(100, parseFloat(p.progress||0) + 10)
      }));

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
    const [p, kpis] = await Promise.all([
      GET('/projects/' + id),
      GET('/projects/' + id + '/kpis').catch(() => ({}))
    ]);

    // Ordena EAP
    function eapKey(code) {
      if (!code) return [9999];
      return String(code).split('.').map(n => parseInt(n,10)||0);
    }
    const tasks = [...(p.tasks||[])].sort((a,b) => {
      const ka=eapKey(a.eap_code), kb=eapKey(b.eap_code);
      for(let i=0;i<Math.max(ka.length,kb.length);i++){const d=(ka[i]||0)-(kb[i]||0);if(d!==0)return d;}
      return 0;
    });

    const fmtR = v => 'R$ '+parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:0});
    const pC   = v => parseFloat(v||0)>=80?'var(--g700)':parseFloat(v||0)>=40?'#E65100':'#C62828';

    document.getElementById('view-title').textContent = p.code + ' — ' + p.name;
    document.getElementById('view-body').innerHTML =

      // ── Header info ──
      '<div style="background:linear-gradient(135deg,#1B5E20,#2E7D32);border-radius:12px;padding:20px 24px;margin-bottom:20px;color:#fff">' +
        '<div style="font-size:12px;color:#A5D6A7;font-weight:600;letter-spacing:.5px;margin-bottom:4px">' + (p.area||'—') + '</div>' +
        '<div style="font-size:18px;font-weight:800;margin-bottom:8px">' + p.name + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:20px;font-size:13px;color:rgba(255,255,255,.8)">' +
          '<span>👤 ' + (p.manager_name||'—') + '</span>' +
          '<span>📅 ' + (fmtDate(p.start_date)||'—') + ' → ' + (fmtDate(p.end_date)||'—') + '</span>' +
          '<span>💰 ' + fmtR(p.budget) + '</span>' +
          '<span>📦 ' + p.status + '</span>' +
        '</div>' +
        '<div style="margin-top:16px">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:6px">' +
            '<span style="font-size:12px;color:rgba(255,255,255,.7)">Progresso geral</span>' +
            '<span style="font-size:14px;font-weight:800">' + parseFloat(p.progress||0).toFixed(1) + '%</span>' +
          '</div>' +
          '<div style="height:8px;background:rgba(255,255,255,.2);border-radius:4px;overflow:hidden">' +
            '<div style="height:100%;width:'+p.progress+'%;background:linear-gradient(90deg,#A5D6A7,#4CAF50);border-radius:4px"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ── KPIs ──
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">' +
        ['total_tasks','tasks_done','active_risks','budget'].map((k,i) => {
          const labels = ['Tarefas','Concluídas','Riscos Ativos','Orçamento'];
          const vals   = [tasks.length, tasks.filter(t=>t.status==='Concluído').length,
                          (p.risks||[]).filter(r=>r.status==='Ativo').length, fmtR(p.budget)];
          const colors = ['var(--text)','var(--g700)','var(--danger)','var(--text)'];
          return '<div style="background:var(--g50);border:1px solid var(--border-md);border-radius:10px;padding:14px;text-align:center">' +
            '<div style="font-size:18px;font-weight:800;color:'+colors[i]+'">' + vals[i] + '</div>' +
            '<div style="font-size:10px;color:var(--text2);font-weight:600;text-transform:uppercase;margin-top:3px">' + labels[i] + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +

      // ── EAP hierárquica ──
      (tasks.length ? '<div style="margin-bottom:20px">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:10px">📋 Estrutura EAP — ' + tasks.length + ' item(s)</div>' +
        '<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
            '<thead><tr style="background:linear-gradient(135deg,#1B5E20,#2E7D32)">' +
              '<th style="padding:8px 12px;text-align:left;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;width:70px">Cód.</th>' +
              '<th style="padding:8px 12px;text-align:left;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase">Ação / Entregável</th>' +
              '<th style="padding:8px 12px;text-align:left;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;width:120px">Responsável</th>' +
              '<th style="padding:8px 12px;text-align:left;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;width:100px">Status</th>' +
              '<th style="padding:8px 12px;text-align:center;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;width:80px">%</th>' +
            '</tr></thead>' +
            '<tbody>' +
              tasks.map((t,idx) => {
                const isObj = t.eap_level===1;
                const indent = (t.eap_level-1)*16;
                const prog = Math.round(parseFloat(t.progress||0));
                const pc = prog>=80?'var(--g600)':prog>=40?'#E65100':'#C62828';
                return '<tr style="' + (isObj?'background:var(--g50);border-top:2px solid var(--border-md)':idx%2===0?'':'background:var(--subtle)') + '">' +
                  '<td style="padding:7px 12px;font-weight:'+(isObj?700:500)+';color:var(--g700);font-size:11px">'+( t.eap_code||'—')+'</td>' +
                  '<td style="padding:7px 12px;padding-left:'+(indent+12)+'px;font-weight:'+(isObj?700:400)+'">'+t.name+'</td>' +
                  '<td style="padding:7px 12px;color:var(--text2)">'+(t.assignee_name||'—')+'</td>' +
                  '<td style="padding:7px 12px">'+statusBadge(t.status)+'</td>' +
                  '<td style="padding:7px 12px;text-align:center">' +
                    '<div style="display:flex;align-items:center;gap:5px;justify-content:center">' +
                      '<div style="width:40px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
                        '<div style="height:100%;width:'+prog+'%;background:'+pc+'"></div>' +
                      '</div>' +
                      '<span style="font-size:11px;font-weight:600;color:'+pc+'">'+prog+'%</span>' +
                    '</div>' +
                  '</td>' +
                '</tr>';
              }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' : '') +

      // ── Riscos ──
      ((p.risks||[]).length ? '<div>' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:10px">⚠️ Riscos (' + p.risks.length + ')</div>' +
        '<div style="border:1px solid #FFCDD2;border-radius:10px;overflow:hidden">' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
            '<thead><tr style="background:linear-gradient(135deg,#B71C1C,#C62828)">' +
              '<th style="padding:8px 12px;text-align:left;color:#fff;font-size:10px;text-transform:uppercase">Código</th>' +
              '<th style="padding:8px 12px;text-align:left;color:#fff;font-size:10px;text-transform:uppercase">Descrição</th>' +
              '<th style="padding:8px 12px;text-align:center;color:#fff;font-size:10px;text-transform:uppercase;width:80px">Severidade</th>' +
              '<th style="padding:8px 12px;text-align:left;color:#fff;font-size:10px;text-transform:uppercase;width:90px">Status</th>' +
            '</tr></thead>' +
            '<tbody>' + p.risks.map((r,idx) => {
              const sev = r.probability*r.impact;
              const sc  = sev>=15?'#C62828':sev>=9?'#E65100':'#2E7D32';
              return '<tr style="'+(idx%2===0?'':'background:#FFF8F8')+'">' +
                '<td style="padding:7px 12px;font-weight:700;font-size:11px">'+(r.code||'—')+'</td>' +
                '<td style="padding:7px 12px">'+r.description+'</td>' +
                '<td style="padding:7px 12px;text-align:center;font-weight:700;color:'+sc+'">'+sev+'</td>' +
                '<td style="padding:7px 12px"><span style="background:'+(r.status==='Ativo'?'#C62828':'#2E7D32')+';color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">'+r.status+'</span></td>' +
              '</tr>';
            }).join('') + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' : '') +

      // ── Botão exportar ──
      '<div style="margin-top:20px;text-align:right">' +
        '<button onclick="exportReport(' + id + ');closeModal(\'modal-view\')" class="btn btn-primary">🖨 Exportar PDF</button>' +
      '</div>';

    openModal('modal-view');
  } catch(e) { toast('Erro: ' + e.message, 'error'); }
}


async function editProject(id) {
  try {
    const p = await GET('/projects/'+id);
    document.getElementById('proj-form-id').value=p.id;
    document.getElementById('proj-modal-title').textContent='Editar — '+p.name;
    await loadUserSelect('proj-manager', p.manager_id);
    const fs=['code','name','description','area','start_date','end_date','status','priority','budget','actual_cost','complexity','strategic_impact','objective','scope_in','scope_out','success_criteria'];
    fs.forEach(f => {
      const el = document.getElementById('proj-' + f.replace(/_/g, '-'));
      if (!el) return;
      let val = p[f] ?? '';
      if ((f === 'start_date' || f === 'end_date') && val)
        val = String(val).replace(' ','T').split('T')[0];
      el.value = val;
    });
    // Preenche barra de progresso
    const prog = Math.round(parseFloat(p.progress)||0);
    const pRange = document.getElementById('proj-progress');
    const pDisp  = document.getElementById('proj-progress-display');
    if (pRange) { pRange.value = prog; pRange.style.background = 'linear-gradient(90deg,var(--g600) '+prog+'%,var(--border) '+prog+'%)'; }
    if (pDisp)  pDisp.textContent = prog + '%';
    openModal('modal-project');
  } catch(e) { toast(e.message,'error'); }
}

async function saveProject(e) {
  e.preventDefault();
  const id = document.getElementById('proj-form-id').value;
  const flds = ['code','name','description','area','manager_id','start_date','end_date','status','priority','budget','actual_cost','progress','complexity','strategic_impact','objective','scope_in','scope_out','success_criteria'];
  const body = {};
  flds.forEach(f => { const el=document.getElementById('proj-'+f.replace(/_/g,'-')); if(el) body[f]=el.value||null; });
  body.budget=parseFloat(body.budget)||0; body.actual_cost=parseFloat(body.actual_cost)||0; body.progress=parseFloat(document.getElementById('proj-progress')?.value)||0;
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
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state" style="padding:48px;text-align:center">Nenhuma tarefa encontrada</td></tr>';
    return;
  }

  // ── Cores por departamento ──────────────────────────────────────
  const DEPT_COLORS = {
    'T.I':                  { bg:'#1565C0', light:'#E3F2FD', border:'#90CAF9' },
    'Financeiro':           { bg:'#2E7D32', light:'#E8F5E9', border:'#A5D6A7' },
    'Controladoria':        { bg:'#4A148C', light:'#F3E5F5', border:'#CE93D8' },
    'Fiscal':               { bg:'#1A237E', light:'#E8EAF6', border:'#9FA8DA' },
    'RH/DP':                { bg:'#E65100', light:'#FFF3E0', border:'#FFCC80' },
    'Compras':              { bg:'#006064', light:'#E0F7FA', border:'#80DEEA' },
    'Suprimentos MP':       { bg:'#33691E', light:'#F1F8E9', border:'#C5E1A5' },
    'Qualidade/Laboratório':{ bg:'#880E4F', light:'#FCE4EC', border:'#F48FB1' },
    'Produção':             { bg:'#BF360C', light:'#FBE9E7', border:'#FFAB91' },
    'Administrativo':       { bg:'#37474F', light:'#ECEFF1', border:'#B0BEC5' },
    'Comercial':            { bg:'#F57F17', light:'#FFFDE7', border:'#FFE082' },
    'Marketing':            { bg:'#AD1457', light:'#FCE4EC', border:'#F48FB1' },
  };
  const DEFAULT_COLOR = { bg:'#546E7A', light:'#ECEFF1', border:'#B0BEC5' };

  // ── Agrupa: área → projeto → tarefas ───────────────────────────
  const byArea = {};
  list.forEach(t => {
    const area    = t.project_area || 'Sem Departamento';
    const projKey = String(t.project_id || 'x');
    if (!byArea[area]) byArea[area] = {};
    if (!byArea[area][projKey]) byArea[area][projKey] = {
      id: t.project_id, name: t.project_name, code: t.project_code, tasks: []
    };
    byArea[area][projKey].tasks.push(t);
  });

  let html = '';

  Object.keys(byArea).sort().forEach(area => {
    const ac = DEPT_COLORS[area] || DEFAULT_COLOR;

    // ══ CABEÇALHO DO DEPARTAMENTO ══════════════════════════════
    html += `<tr>
      <td colspan="9" style="padding:0;border:none">
        <div style="background:${ac.bg};padding:11px 20px;display:flex;align-items:center;gap:12px;margin-top:10px;border-radius:8px 8px 0 0">
          <span style="font-size:18px">🏢</span>
          <span style="font-size:13px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:1.2px">${area}</span>
        </div>
      </td>
    </tr>`;

    Object.values(byArea[area]).forEach((proj, pIdx, projArr) => {
      const sorted  = _sortEAP(proj.tasks);
      const done    = sorted.filter(t => t.status === 'Concluído').length;
      const total   = sorted.length;
      const avgProg = total ? Math.round(sorted.reduce((s,t) => s + parseFloat(t.progress||0), 0) / total) : 0;
      const isLast  = pIdx === projArr.length - 1;

      // ── Cabeçalho do PROJETO ──────────────────────────────────
      html += `<tr>
        <td colspan="9" style="padding:0;border:none">
          <div style="background:${ac.light};border-left:4px solid ${ac.bg};border-top:1px solid ${ac.border};border-bottom:1px solid ${ac.border};padding:10px 18px;display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="background:${ac.bg};color:#fff;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700">${proj.code||'—'}</span>
              <span style="font-size:14px;font-weight:700;color:#212121">${proj.name||'Projeto'}</span>
            </div>
            <div style="display:flex;align-items:center;gap:14px">
              <span style="font-size:11px;color:#616161">${done}/${total} concluídas</span>
              <div style="display:flex;align-items:center;gap:6px">
                <div style="width:72px;height:6px;background:rgba(0,0,0,.12);border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${avgProg}%;background:${ac.bg};border-radius:3px"></div>
                </div>
                <span style="font-size:11px;font-weight:700;color:${ac.bg}">${avgProg}%</span>
              </div>
              <button onclick="viewProject(${proj.id})"
                style="background:none;border:1px solid ${ac.bg};color:${ac.bg};padding:3px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">
                👁 Ver
              </button>
            </div>
          </div>
        </td>
      </tr>`;

      // ── Tarefas ────────────────────────────────────────────────
      sorted.forEach((t, idx) => {
        const isObj  = t.eap_level === 1;
        const indent = Math.max(0, (t.eap_level - 1)) * 24;
        const prog   = Math.round(t.progress || 0);
        const pc     = prog >= 80 ? '#2E7D32' : prog >= 40 ? '#E65100' : '#C62828';
        const rowBg  = isObj
          ? `background:${ac.light};border-bottom:1px solid ${ac.border}`
          : idx % 2 === 0 ? '' : 'background:var(--subtle)';

        html += `<tr style="${rowBg}">
          <td style="padding:8px 12px;width:84px;vertical-align:middle">
            ${isObj
              ? `<span style="background:${ac.bg};color:#fff;padding:3px 9px;border-radius:8px;font-size:11px;font-weight:700">${t.eap_code||'—'}</span>`
              : `<span style="font-size:11px;font-weight:600;color:${ac.bg};padding-left:10px">${t.eap_code||'—'}</span>`
            }
          </td>
          <td style="padding:8px 12px;padding-left:${indent+12}px;vertical-align:middle">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-weight:${isObj?700:400};font-size:${isObj?13:12}px">${t.name}</span>
              ${t.milestone ? '<span style="font-size:12px" title="Marco">🏁</span>' : ''}
            </div>
            ${t.description ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;font-style:italic">${t.description.slice(0,90)}${t.description.length>90?'…':''}</div>` : ''}
          </td>
          <td style="padding:8px 12px;vertical-align:middle">${statusBadge(t.status)}</td>
          <td style="padding:8px 12px;vertical-align:middle">
            <div class="progress-inline">
              <input type="range" min="0" max="100" value="${prog}"
                oninput="this.nextElementSibling.textContent=this.value+'%'"
                onchange="inlineTaskProgress(${t.id},this.value);var x=_tasks.find(x=>x.id==${t.id});if(x)x.progress=+this.value">
              <span style="font-weight:600;color:${pc}">${prog}%</span>
            </div>
          </td>
          <td style="padding:8px 12px;font-size:11px;color:var(--text2);vertical-align:middle">${fmtDate(t.start_date)}</td>
          <td style="padding:8px 12px;font-size:11px;color:var(--text2);vertical-align:middle">${fmtDate(t.end_date)}</td>
          <td style="padding:8px 12px;font-size:11px;color:var(--text2);vertical-align:middle">${t.assignee_name||'—'}</td>
          <td style="padding:8px 12px;text-align:center;vertical-align:middle">${t.milestone?'✅':'—'}</td>
          <td style="padding:8px 12px;vertical-align:middle">
            <div class="td-actions">
              <button class="btn btn-sm btn-secondary btn-icon" onclick="openTaskUpdates(${t.id},this)" title="Atividades" data-name="${t.name.replace(/"/g,'&quot;')}">📋</button>
              <button class="btn btn-sm btn-secondary btn-icon" onclick="editTask(${t.id})" title="Editar">✏️</button>
              <button class="btn btn-sm btn-danger btn-icon" onclick="deleteTask(${t.id},&quot;${t.name.replace(/"/g,'')}&quot;)" title="Remover">🗑</button>
            </div>
          </td>
        </tr>`;
      });

      // Separador entre projetos
      if (!isLast) {
        html += '<tr><td colspan="9" style="padding:3px 0;background:var(--subtle);border:none"></td></tr>';
      }
    });

    // Espaço entre departamentos
    html += '<tr><td colspan="9" style="padding:4px 0;border:none"></td></tr>';
  });

  tbody.innerHTML = html;
}


