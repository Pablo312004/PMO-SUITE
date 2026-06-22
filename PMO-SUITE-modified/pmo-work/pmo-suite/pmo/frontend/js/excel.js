/**
 * PMO Suite — Importação via Excel  (Modelo: Plano de Ação 2026)
 * ─────────────────────────────────────────────────────────────
 * Suporta dois modos:
 *   • Arquivo único  — fluxo em 3 steps com preview detalhado
 *   • Lote (batch)   — N arquivos processados em sequência
 *
 * Formato da planilha (qualquer nome de aba):
 *
 *  Linha 3 → cabeçalho bloco A: NOME DO PROJETO | valor | ÁREA / DEPARTAMENTO | valor | CÓDIGO DO PROJETO: <valor>
 *  Linha 4 → cabeçalho bloco B: GESTOR DO PROJETO | valor | DATA DE INÍCIO | valor | DATA DE TÉRMINO DO PROJETO: <valor>
 *
 *  Obs: Código e Data de Término podem vir EMBUTIDOS na própria célula label (ex: "CÓDIGO DO PROJETO: SMP - 001")
 *
 *  Linha de header de colunas (detectada por conter AÇÃO/ENTREGÁVEL + RESPONSÁVEL ou STATUS):
 *    Col B → CÓDIGO EAP    (1, 2, 1.1, 1.2 …)
 *    Col C → AÇÃO / ENTREGÁVEL
 *    Col D → RESPONSÁVEL
 *    Col E → PRIORIDADE
 *    Col F → STATUS
 *    Col G → INÍCIO
 *    Col H → TÉRMINO
 *    Col I → PROGRESSO (%)
 *    Col J → CUSTO ESTIMADO (R$)
 *    Col K → CUSTO REALIZADO (R$)
 *    Col L → OBSERVAÇÕES
 *
 *  EAP inteiro (1, 2, 3…)  → objetivo estratégico (nível 1)
 *  EAP com ponto (1.1, 2.3) → ação executável (nível 2+)
 *  Linha "TOTAL DO PROJETO" → ignorada
 */

/* ═══════════════════════════════════════════════════════════════
   ESTADO
═══════════════════════════════════════════════════════════════ */
const xlsState = {
  step: 1,
  file: null,
  wb: null,
  parsedProject: null,
  parsedTasks: [],
  validationErrors: [],
  // lote
  batchFiles: [],
  batchResults: [],
  batchMode: false,
};

/* ═══════════════════════════════════════════════════════════════
   ABERTURA / RESET
═══════════════════════════════════════════════════════════════ */
function openExcelImport() {
  Object.assign(xlsState, {
    step: 1, file: null, wb: null,
    parsedProject: null, parsedTasks: [], validationErrors: [],
    batchFiles: [], batchResults: [], batchMode: false,
  });
  xlsSetStep(1);
  _show('xls-dropzone');
  _hide('xls-file-info');
  _hide('xls-import-result');
  _hide('xls-batch-panel');
  document.getElementById('xls-file-input').value       = '';
  document.getElementById('xls-file-input-batch').value = '';
  _setBtnNext(false, 'Próximo →', xlsNext);
  openModal('modal-excel');
}

/* ═══════════════════════════════════════════════════════════════
   STEPS
═══════════════════════════════════════════════════════════════ */
function xlsSetStep(n) {
  xlsState.step = n;
  [1, 2, 3].forEach(i => {
    const el = document.getElementById('xls-step-' + i);
    if (el) el.style.display = i === n ? 'block' : 'none';
  });
  const back = document.getElementById('xls-btn-back');
  if (back) back.style.display = n > 1 ? 'inline-flex' : 'none';

  const isLast = n === 3;
  _setBtnNext(
    !(n === 1 && !xlsState.file && !xlsState.batchMode),
    isLast ? '🚀 Importar' : 'Próximo →',
    isLast ? xlsRunImport : xlsNext
  );

  [1, 2, 3].forEach(i => {
    const num  = document.getElementById('xstep-num-' + i);
    const wrap = document.getElementById('xstep-' + i);
    if (num) { num.style.background = i <= n ? 'var(--g700)' : 'var(--border)'; num.style.color = i <= n ? '#fff' : 'var(--text3)'; }
    if (wrap) {
      wrap.style.borderBottomColor = i === n ? 'var(--g700)' : 'transparent';
      const lbl = wrap.querySelector('span');
      if (lbl) lbl.style.color = i === n ? 'var(--g800)' : i < n ? 'var(--text)' : 'var(--text2)';
    }
  });
}

function xlsNext() {
  if (xlsState.step === 1) {
    if (xlsState.batchMode) {
      if (!xlsState.batchFiles.length) { toast('Selecione ao menos um arquivo', 'error'); return; }
      xlsBuildBatchConfirm();
      xlsSetStep(3);
      return;
    }
    if (!xlsState.file) { toast('Selecione um arquivo', 'error'); return; }
    _setBtnNext(false, '⏳ Lendo…', null);
    xlsParseFile()
      .then(() => xlsSetStep(2))
      .catch(e => { toast(e.message, 'error'); _setBtnNext(true, 'Próximo →', xlsNext); });
  } else if (xlsState.step === 2) {
    xlsBuildConfirmScreen();
    xlsSetStep(3);
  }
}

/* ═══════════════════════════════════════════════════════════════
   TOGGLE MODO ÚNICO / LOTE
═══════════════════════════════════════════════════════════════ */
function xlsToggleBatch(enable) {
  xlsState.batchMode  = enable;
  xlsState.file       = null;
  xlsState.batchFiles = [];
  document.getElementById('xls-file-input').value       = '';
  document.getElementById('xls-file-input-batch').value = '';

  const single = document.getElementById('xls-single-area');
  const batch  = document.getElementById('xls-batch-panel');
  if (single) single.style.display = enable ? 'none' : 'block';
  if (batch)  batch.style.display  = enable ? 'block' : 'none';
  _hide('xls-file-info');
  _hide('xls-batch-list');
  _setBtnNext(false, 'Próximo →', xlsNext);

  ['xls-mode-single', 'xls-mode-batch'].forEach(id => {
    const active = (id === 'xls-mode-batch') === enable;
    const el = document.getElementById(id);
    if (el) {
      el.style.fontWeight   = active ? '600' : '400';
      el.style.borderColor  = active ? 'var(--g600)' : 'var(--border)';
      el.style.color        = active ? 'var(--g800)' : 'var(--text2)';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   ARQUIVO ÚNICO — seleção / drag-drop
═══════════════════════════════════════════════════════════════ */
function xlsFileSelected(e)  { const f = e.target.files[0]; if (f) xlsSetFile(f); }
function xlsDragOver(e)      { e.preventDefault(); const dz = document.getElementById('xls-dropzone'); dz.style.borderColor = 'var(--g600)'; dz.style.background = 'var(--g50)'; }
function xlsDragLeave()      { const dz = document.getElementById('xls-dropzone'); dz.style.borderColor = 'var(--border-md)'; dz.style.background = 'var(--subtle)'; }
function xlsDrop(e) {
  e.preventDefault(); xlsDragLeave();
  const f = e.dataTransfer.files[0];
  if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) xlsSetFile(f);
  else toast('Apenas .xlsx são suportados', 'error');
}

function xlsSetFile(file) {
  if (file.size > 15 * 1024 * 1024) { toast('Arquivo muito grande (máx 15 MB)', 'error'); return; }
  xlsState.file = file;
  _hide('xls-dropzone');
  const fi = document.getElementById('xls-file-info');
  fi.style.display = 'flex';
  document.getElementById('xls-fname').textContent = file.name;
  document.getElementById('xls-fsize').textContent = (file.size / 1024).toFixed(1) + ' KB';
  _setBtnNext(true, 'Próximo →', xlsNext);
}

function xlsClearFile() {
  xlsState.file = null;
  document.getElementById('xls-file-input').value = '';
  _show('xls-dropzone');
  _hide('xls-file-info');
  _setBtnNext(false, 'Próximo →', xlsNext);
}

/* ═══════════════════════════════════════════════════════════════
   LOTE — seleção múltipla / drag-drop
═══════════════════════════════════════════════════════════════ */
function xlsBatchFilesSelected(e) {
  const files = Array.from(e.target.files).filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
  if (!files.length) { toast('Nenhum .xlsx na seleção', 'error'); return; }
  xlsState.batchFiles = files;
  _renderBatchList();
  _setBtnNext(true, `Continuar com ${files.length} arquivo(s) →`, xlsNext);
}
function xlsBatchDragOver(e)  { e.preventDefault(); document.getElementById('xls-batch-dropzone').style.borderColor = 'var(--g600)'; document.getElementById('xls-batch-dropzone').style.background = 'var(--g50)'; }
function xlsBatchDragLeave()  { document.getElementById('xls-batch-dropzone').style.borderColor = 'var(--border-md)'; document.getElementById('xls-batch-dropzone').style.background = 'var(--subtle)'; }
function xlsBatchDrop(e) {
  e.preventDefault(); xlsBatchDragLeave();
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
  if (!files.length) { toast('Apenas .xlsx são suportados', 'error'); return; }
  xlsState.batchFiles = files;
  _renderBatchList();
  _setBtnNext(true, `Continuar com ${files.length} arquivo(s) →`, xlsNext);
}
function xlsRemoveBatchFile(idx) {
  xlsState.batchFiles.splice(idx, 1);
  _renderBatchList();
  if (!xlsState.batchFiles.length) _setBtnNext(false, 'Próximo →', xlsNext);
  else _setBtnNext(true, `Continuar com ${xlsState.batchFiles.length} arquivo(s) →`, xlsNext);
}
function _renderBatchList() {
  const list = document.getElementById('xls-batch-list');
  if (!list) return;
  list.style.display = xlsState.batchFiles.length ? 'block' : 'none';
  list.innerHTML = `
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:8px">${xlsState.batchFiles.length} arquivo(s)</div>
    ${xlsState.batchFiles.map((f, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--g50);border:1px solid rgba(46,125,50,.2);border-radius:6px;margin-bottom:6px;font-size:13px">
      <span style="font-size:18px">📊</span>
      <div style="flex:1;overflow:hidden"><div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</div><div style="font-size:11px;color:var(--text3)">${(f.size/1024).toFixed(1)} KB</div></div>
      <button onclick="xlsRemoveBatchFile(${i})" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:2px 6px" title="Remover">✕</button>
    </div>`).join('')}`;
}

/* ═══════════════════════════════════════════════════════════════
   PARSING — arquivo único (entry point)
═══════════════════════════════════════════════════════════════ */
async function xlsParseFile() {
  if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada');
  const buf = await xlsState.file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
  xlsState.wb = wb;
  if (!wb.SheetNames.length) throw new Error('Planilha vazia ou corrompida');
  const rows   = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: false });
  if (!rows.length) throw new Error('A planilha não contém dados');
  const result = _parseModel(rows, wb.SheetNames[0]);
  xlsState.parsedProject    = result.project;
  xlsState.parsedTasks      = result.tasks;
  xlsState.validationErrors = result.errors;
  _renderStep2Preview(result);
}

/* ═══════════════════════════════════════════════════════════════
   PARSING — núcleo (reutilizado por único e lote)
═══════════════════════════════════════════════════════════════ */
async function _parseFileObject(file) {
  if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada');
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
  if (!wb.SheetNames.length) throw new Error('Planilha vazia');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: false });
  return _parseModel(rows, wb.SheetNames[0]);
}

/**
 * Parser principal — lida com o formato real do PMO:
 *  - Código e Data de Término podem estar embutidos na célula label
 *  - Datas podem ser string ISO, serial Excel, DD/MM/YYYY ou timestamp
 *  - Aba pode ter qualquer nome
 */
function _parseModel(rows, sheetName) {
  const errors  = [];
  const project = { code: '', name: '', area: '', manager: '', start_date: null, end_date: null, budget: 0 };

  /* ── 1. METADADOS DO PROJETO ─────────────────────────────────────────
     Varre as primeiras 5 linhas buscando pares label→valor.
     Trata casos onde o valor está embutido na label:
       "CÓDIGO DO PROJETO: SMP - 001"  → code = "SMP - 001"
       "DATA DE TÉRMINO DO PROJETO: 01/04/2027" → end_date = "2027-04-01"
  ─────────────────────────────────────────────────────────────────── */
  rows.slice(0, 5).forEach(row => {
    if (!row) return;
    for (let c = 0; c < row.length; c++) {
      const cell  = _clean(row[c]);
      const upper = cell.toUpperCase();
      if (!upper) continue;

      // Modelo real PMO: label em B, valor em D (pula uma coluna mesclada).
      // Estratégia: tenta c+1, c+2 e c+3 — pega o primeiro não-vazio.
      // Também extrai valor embutido após ":" na própria célula (ex: "CÓDIGO DO PROJETO: SMP-001")
      const selfVal = upper.includes(':') ? cell.slice(cell.indexOf(':') + 1).trim() : '';
      const nextVal = [1, 2, 3]
        .map(offset => (c + offset < row.length ? _clean(row[c + offset]) : ''))
        .find(v => v !== '') || '';

      // Usa _norm() para comparar sem acentos (cobre INÍCIO/INICIO, ÁREA/AREA, etc.)
      const norm = _norm(cell);

      if (norm.includes('NOME DO PROJETO')) {
        project.name = selfVal || nextVal;
      }
      if (norm.includes('REA') && (norm.includes('DEPARTAMENTO') || norm.includes('REA /'))) {
        project.area = _normalizeArea(selfVal || nextVal);
      }
      if (norm.includes('DIGO DO PROJETO') || norm.includes('CODIGO DO PROJETO')) {
        project.code = selfVal || nextVal;
      }
      if (norm.startsWith('GESTOR')) {
        project.manager = selfVal || nextVal;
      }
      if (norm.includes('INICIO DO PROJETO')) {
        const raw = selfVal || nextVal;
        if (raw) project.start_date = _parseDate(raw);
      }
      if (norm.includes('TERMINO') && !norm.includes('INICIO')) {
        const raw = selfVal || nextVal;
        if (raw) project.end_date = _parseDate(raw);
      }
    }
  });

  /* ── 2. LOCALIZAR LINHA DE CABEÇALHO DAS COLUNAS ─────────────────── */
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const joined = r.map(c => _clean(c)).join('|').toLowerCase();
    const hasAcao = joined.includes('ação') || joined.includes('acao') ||
                    joined.includes('entregável') || joined.includes('entregavel');
    const hasRef  = joined.includes('responsável') || joined.includes('responsavel') ||
                    joined.includes('status') || joined.includes('início') || joined.includes('inicio');
    if (hasAcao && hasRef) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1)
    throw new Error(
      `Cabeçalho das colunas não encontrado na aba "${sheetName}".\n` +
      'A linha de cabeçalho deve conter AÇÃO/ENTREGÁVEL e RESPONSÁVEL ou STATUS.'
    );

  /* ── 3. MAPEAMENTO DINÂMICO DE COLUNAS ───────────────────────────── */
  const hRow = rows[headerRowIdx].map(c => _clean(c).toLowerCase());
  const COL = {
    eap:      _findCol(hRow, ['código', 'codigo', 'eap', 'cód', 'cod']),
    name:     _findCol(hRow, ['ação', 'acao', 'entregável', 'entregavel', 'tarefa', 'nome']),
    assignee: _findCol(hRow, ['responsável', 'responsavel', 'executor']),
    priority: _findCol(hRow, ['prioridade', 'priority']),
    status:   _findCol(hRow, ['status', 'situação', 'situacao']),
    start:    _findCol(hRow, ['início', 'inicio', 'start', 'data início', 'data inicio']),
    end:      _findCol(hRow, ['término', 'termino', 'fim', 'end', 'prazo', 'data fim', 'data término']),
    progress: _findCol(hRow, ['progresso', 'progress', '%']),
    budget:   _findCol(hRow, ['estimado', 'orçamento', 'orcamento', 'budget', 'custo est']),
    actual:   _findCol(hRow, ['realizado', 'actual', 'custo real', 'custo rea']),
    notes:    _findCol(hRow, ['observ', 'notes', 'comentário', 'comentario', 'obs']),
  };

  /* ── 4. ITERAR LINHAS DE DADOS ───────────────────────────────────── */
  const tasks = [];
  const STOP  = ['total do projeto', 'total geral', 'total'];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === null || _clean(c) === '')) continue;

    const eapRaw  = _g(row, COL.eap);
    const nameRaw = _g(row, COL.name);
    const rowNum  = i + 1;

    // Ignorar linha de total
    if (STOP.some(k => (eapRaw || '').toLowerCase().startsWith(k) ||
                       (nameRaw || '').toLowerCase().startsWith(k))) continue;

    // Linha sem nome e sem EAP → pular
    if (!eapRaw && !nameRaw) continue;

    // Linha com EAP mas sem nome → reportar aviso e pular
    if (!nameRaw) {
      errors.push({ row: rowNum, col: 'Ação/Entregável', msg: 'Linha com código EAP mas sem nome de ação' });
      continue;
    }

    const startDate = _parseDate(_g(row, COL.start));
    const endDate   = _parseDate(_g(row, COL.end));
    const progress  = _parseProgress(_g(row, COL.progress));
    const budget    = _parseMoney(_g(row, COL.budget));
    const actual    = _parseMoney(_g(row, COL.actual));
    const eapLevel  = _calcEapLevel(eapRaw);

    if (startDate && endDate && startDate > endDate)
      errors.push({ row: rowNum, col: 'Datas', msg: `Início (${startDate}) é posterior ao Término (${endDate})` });

    tasks.push({
      eap_code:    eapRaw || String(tasks.length + 1),
      eap_level:   eapLevel,
      name:        nameRaw,
      assignee:    _g(row, COL.assignee) || null,
      priority:    _mapPriority(_g(row, COL.priority)),
      status:      _mapStatus(_g(row, COL.status)),
      start_date:  startDate,
      end_date:    endDate,
      progress,
      budget,
      actual_cost: actual,
      notes:       _g(row, COL.notes) || null,
      _row:        rowNum,
    });
  }

  /* ── 5. PÓS-PROCESSAMENTO DO PROJETO ─────────────────────────────── */
  if (!project.name)
    errors.push({ row: '—', col: 'Nome do Projeto', msg: 'Campo obrigatório não encontrado no cabeçalho' });

  // Código automático se não informado
  if (!project.code)
    project.code = 'PMO-' + Date.now().toString(36).toUpperCase();

  // Herdar datas do menor/maior intervalo das tarefas
  const starts = tasks.map(t => t.start_date).filter(Boolean).sort();
  const ends   = tasks.map(t => t.end_date).filter(Boolean).sort();
  if (!project.start_date && starts.length) project.start_date = starts[0];
  if (!project.end_date   && ends.length)   project.end_date   = ends[ends.length - 1];

  // Orçamento = soma das ações (nível > 1)
  project.budget = tasks.filter(t => t.eap_level > 1).reduce((s, t) => s + t.budget, 0);

  return { project, tasks, errors };
}

/* ═══════════════════════════════════════════════════════════════
   PREVIEW — STEP 2
═══════════════════════════════════════════════════════════════ */
function _renderStep2Preview({ project, tasks, errors }) {
  const container = document.getElementById('xls-preview');
  if (!container) return;

  const objectives = tasks.filter(t => t.eap_level === 1);
  const actions    = tasks.filter(t => t.eap_level >  1);
  const hasErr     = errors.length > 0;
  const fmtR = v => typeof fmtCurrency === 'function' ? fmtCurrency(v) : 'R$ ' + v.toFixed(2);

  container.innerHTML = `
    <!-- Cartão do Projeto -->
    <div style="background:var(--g50);border:1px solid rgba(46,125,50,.25);border-radius:var(--r8);padding:16px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--g700);margin-bottom:10px">📁 Dados do Projeto detectados</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;font-size:13px">
        ${_metaItem('Código',        project.code       || '<i style="color:#e65100">Automático</i>')}
        ${_metaItem('Nome',          project.name       || '<span style="color:var(--danger)">⚠ Não informado</span>')}
        ${_metaItem('Área',          project.area       || '—')}
        ${_metaItem('Gestor',        project.manager    || '—')}
        ${_metaItem('Início',        project.start_date || '—')}
        ${_metaItem('Término',       project.end_date   || '—')}
        ${project.budget > 0 ? _metaItem('Orçamento',   fmtR(project.budget)) : ''}
      </div>
    </div>

    <!-- Alertas de validação -->
    ${hasErr ? `
    <div style="background:#fff3e0;border:1px solid #ffb300;border-radius:var(--r8);padding:11px 14px;margin-bottom:14px">
      <div style="font-weight:600;color:#e65100;margin-bottom:5px">⚠ ${errors.length} aviso(s) — importação prosseguirá com dados válidos</div>
      <div style="font-size:12px;color:#bf360c">
        ${errors.slice(0, 5).map(e => `<div>Linha <b>${e.row}</b> · ${e.col}: ${e.msg}</div>`).join('')}
        ${errors.length > 5 ? `<div style="font-style:italic;margin-top:3px">…e mais ${errors.length - 5} aviso(s)</div>` : ''}
      </div>
    </div>` : `
    <div style="background:var(--g50);border:1px solid rgba(46,125,50,.25);border-radius:var(--r8);padding:9px 14px;margin-bottom:14px;font-size:13px;color:var(--g800)">
      ✅ <b>${objectives.length} objetivo(s)</b> · <b>${actions.length} ação(ões)</b> — nenhum erro encontrado
    </div>`}

    <!-- Tabela EAP -->
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:8px">
      Estrutura EAP — ${tasks.length} linha(s)
    </div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:var(--r8)">
      <table style="font-size:12px;width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--subtle);border-bottom:1px solid var(--border)">
            <th style="padding:7px 10px;text-align:left;white-space:nowrap">Cód. EAP</th>
            <th style="padding:7px 10px;text-align:left">Ação / Entregável</th>
            <th style="padding:7px 10px;text-align:left;white-space:nowrap">Responsável</th>
            <th style="padding:7px 10px;text-align:left">Status</th>
            <th style="padding:7px 10px;text-align:center;white-space:nowrap">%</th>
            <th style="padding:7px 10px;text-align:right;white-space:nowrap">Custo Est.</th>
            <th style="padding:7px 10px;text-align:left">Observações</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map((t, idx) => `
          <tr style="${idx % 2 === 0 ? '' : 'background:var(--subtle)'}${t.eap_level === 1 ? ';border-top:2px solid var(--border-md)' : ''}">
            <td style="padding:5px 10px;font-weight:${t.eap_level === 1 ? 700 : 500};color:var(--g700);white-space:nowrap">${t.eap_code}</td>
            <td style="padding:5px 10px;padding-left:${(t.eap_level - 1) * 18 + 10}px;${t.eap_level === 1 ? 'font-weight:600;' : ''}max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.name}">${t.name}</td>
            <td style="padding:5px 10px;color:var(--text2);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.assignee || ''}">${t.assignee || '—'}</td>
            <td style="padding:5px 10px">${typeof statusBadge === 'function' ? statusBadge(t.status) : `<span>${t.status}</span>`}</td>
            <td style="padding:5px 10px;text-align:center">
              <div style="display:flex;align-items:center;gap:4px;justify-content:center">
                <div style="width:40px;height:4px;border-radius:2px;background:var(--border);overflow:hidden;flex-shrink:0">
                  <div style="height:100%;width:${t.progress}%;background:var(--g600)"></div>
                </div>
                <span style="font-size:11px;color:var(--text2)">${t.progress}%</span>
              </div>
            </td>
            <td style="padding:5px 10px;text-align:right;color:var(--text2);white-space:nowrap">${t.budget > 0 ? fmtR(t.budget) : '—'}</td>
            <td style="padding:5px 10px;color:var(--text3);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.notes || ''}">${t.notes || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function _metaItem(label, value) {
  return `<div><div style="font-size:11px;color:var(--text3);margin-bottom:2px">${label}</div><div style="font-weight:600">${value || '—'}</div></div>`;
}

/* ═══════════════════════════════════════════════════════════════
   CONFIRMAÇÃO — STEP 3 (modo único)
═══════════════════════════════════════════════════════════════ */
function xlsBuildConfirmScreen() {
  const body = document.getElementById('xls-confirm-body');
  if (!body) return;
  const p       = xlsState.parsedProject;
  const tasks   = xlsState.parsedTasks;
  const actions = tasks.filter(t => t.eap_level > 1);
  const objs    = tasks.filter(t => t.eap_level === 1);
  const fmtR    = v => typeof fmtCurrency === 'function' ? fmtCurrency(v) : 'R$ ' + v;

  body.innerHTML = `
    <div class="grid g3" style="margin-bottom:16px">
      ${typeof kpiMini === 'function' ? kpiMini('1','Projeto') + kpiMini(String(objs.length),'Objetivo(s)') + kpiMini(String(actions.length),'Ação(ões)') : ''}
    </div>
    <div style="background:var(--g50);border:1px solid rgba(46,125,50,.25);border-radius:var(--r8);padding:14px 16px;margin-bottom:14px;font-size:13px">
      <b>${p.name || 'Projeto sem nome'}</b>
      ${p.code ? `<span style="color:var(--text2);margin-left:8px">[${p.code}]</span>` : ''}
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:14px;color:var(--text2);font-size:12px">
        ${p.area    ? `<span>🏢 ${p.area}</span>`    : ''}
        ${p.manager ? `<span>👤 ${p.manager}</span>` : ''}
        ${(p.start_date || p.end_date) ? `<span>📅 ${p.start_date || '?'} → ${p.end_date || '?'}</span>` : ''}
        ${p.budget > 0 ? `<span>💰 ${fmtR(p.budget)}</span>` : ''}
      </div>
    </div>
    ${xlsState.validationErrors.length ? `
    <div style="background:#fff3e0;border:1px solid #ffb300;border-radius:var(--r8);padding:9px 13px;margin-bottom:13px;font-size:12px;color:#bf360c">
      ⚠ ${xlsState.validationErrors.length} aviso(s) de validação. A importação prosseguirá com os dados válidos.
    </div>` : ''}
    <div style="font-size:13px;color:var(--text2)">
      Confirme para criar o projeto <b>"${p.name}"</b> com <b>${objs.length} objetivo(s)</b> e <b>${actions.length} ação(ões)</b>.
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   CONFIRMAÇÃO — STEP 3 (modo lote)
═══════════════════════════════════════════════════════════════ */
function xlsBuildBatchConfirm() {
  const body = document.getElementById('xls-confirm-body');
  if (!body) return;
  const n = xlsState.batchFiles.length;
  body.innerHTML = `
    <div style="background:var(--g50);border:1px solid rgba(46,125,50,.25);border-radius:var(--r8);padding:16px;margin-bottom:14px">
      <div style="font-size:15px;font-weight:700;color:var(--g800);margin-bottom:8px">📦 Importação em Lote</div>
      <div style="color:var(--text2);margin-bottom:12px"><b>${n}</b> arquivo(s) serão processados em sequência. Cada arquivo cria um projeto independente.</div>
      ${xlsState.batchFiles.map(f => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span>📊</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
        <span style="color:var(--text3)">${(f.size/1024).toFixed(1)} KB</span>
      </div>`).join('')}
    </div>
    <div style="font-size:13px;color:var(--text2)">Clique em <b>Importar</b> para iniciar. O progresso será exibido em tempo real.</div>`;
  _setBtnNext(true, `🚀 Importar ${n} arquivo(s)`, xlsRunImport);
}

/* ═══════════════════════════════════════════════════════════════
   IMPORTAÇÃO — MODO ÚNICO
═══════════════════════════════════════════════════════════════ */
async function xlsRunImport() {
  if (xlsState.batchMode) { await xlsRunBatchImport(); return; }

  const btn    = document.getElementById('xls-btn-next');
  const result = document.getElementById('xls-import-result');
  btn.disabled = true; btn.textContent = '⏳ Importando…';
  result.style.display = 'none';

  const stats = { tasksOk: 0, tasksFail: 0, errors: [] };

  try {
    const p         = xlsState.parsedProject;
    const projectId = await _upsertProject(p);

    for (const t of xlsState.parsedTasks) {
      try {
        await POST('/tasks', {
          project_id:  projectId,
          name:        t.name,
          description: t.notes       || null,
          start_date:  t.start_date  || null,
          end_date:    t.end_date    || null,
          status:      t.status,
          progress:    t.progress,
          milestone:   0,
          eap_level:   t.eap_level,
          eap_code:    t.eap_code,
          budget:      t.budget      || 0,
          actual_cost: t.actual_cost || 0,
        });
        stats.tasksOk++;
      } catch (e) {
        stats.tasksFail++;
        stats.errors.push(`Linha ${t._row} "${t.name.slice(0, 40)}": ${e.message}`);
      }
    }

    result.style.display = 'block';
    const ok = stats.tasksFail === 0;
    result.innerHTML = `
      <div class="alert ${ok ? 'alert-success' : 'alert-warning'}"><div>
        <div class="alert-title">${ok ? '✅' : '⚠'} Importação concluída${ok ? '!' : ' com avisos!'}</div>
        <div class="alert-desc">
          Projeto <b>"${p.name}"</b> criado · ${stats.tasksOk} ação(ões) importada(s)
          ${stats.tasksFail ? ` · ${stats.tasksFail} erro(s)` : ''}
        </div>
        ${stats.errors.length ? `<div style="margin-top:7px;font-size:11px;color:var(--text2)">${stats.errors.slice(0,4).join('<br>')}</div>` : ''}
      </div></div>`;

    toast(`"${p.name}" importado com ${stats.tasksOk} ações!`, 'success');
    btn.textContent = '✓ Fechar'; btn.disabled = false;
    btn.onclick = () => { closeModal('modal-excel'); loadProjects(); loadDashboard(); };
    setTimeout(() => { loadDashboard(); loadProjects(); }, 500);

  } catch (e) {
    result.style.display = 'block';
    result.innerHTML = `<div class="alert alert-danger"><div class="alert-desc">❌ ${e.message}</div></div>`;
    btn.disabled = false; btn.textContent = '🚀 Tentar Novamente'; btn.onclick = xlsRunImport;
    toast('Erro: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════
   IMPORTAÇÃO — MODO LOTE
═══════════════════════════════════════════════════════════════ */
async function xlsRunBatchImport() {
  const btn    = document.getElementById('xls-btn-next');
  const result = document.getElementById('xls-import-result');
  const body   = document.getElementById('xls-confirm-body');

  btn.disabled = true;
  result.style.display = 'none';
  xlsState.batchResults = [];

  const files = xlsState.batchFiles;
  let totalTasks = 0, totalBudget = 0;

  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:12px">⏳ Processando ${files.length} arquivo(s)…</div>
    <div id="xls-batch-progress"></div>`;

  const progressEl = document.getElementById('xls-batch-progress');

  function _repaint() {
    progressEl.innerHTML = files.map((f, i) => {
      const r    = xlsState.batchResults[i];
      const icon = !r ? '🔄' : r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '❌';
      const desc = !r
        ? '<span style="color:var(--text3)">Aguardando…</span>'
        : r.status === 'error'
          ? `<span style="color:var(--danger)">${r.error}</span>`
          : `<span style="color:var(--g700)">${r.project} — ${r.tasksOk} ação(ões)${r.tasksFail ? ` / ${r.tasksFail} erro(s)` : ''}</span>`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span>${icon}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${f.name}</span>
        ${desc}
      </div>`;
    }).join('');
  }

  _repaint();

  for (let i = 0; i < files.length; i++) {
    btn.textContent = `⏳ ${i + 1}/${files.length}`;
    try {
      const { project, tasks, errors } = await _parseFileObject(files[i]);
      const projectId = await _upsertProject(project);
      let tasksOk = 0, tasksFail = 0;
      for (const t of tasks) {
        try {
          await POST('/tasks', {
            project_id: projectId, name: t.name, description: t.notes || null,
            start_date: t.start_date || null, end_date: t.end_date || null,
            status: t.status, progress: t.progress, milestone: 0,
            eap_level: t.eap_level, eap_code: t.eap_code,
            budget: t.budget || 0, actual_cost: t.actual_cost || 0,
          });
          tasksOk++;
        } catch { tasksFail++; }
      }
      totalTasks  += tasksOk;
      totalBudget += project.budget || 0;
      xlsState.batchResults[i] = {
        status: (tasksFail > 0 || errors.length > 0) ? 'warn' : 'ok',
        project: project.name, tasksOk, tasksFail,
      };
    } catch (e) {
      xlsState.batchResults[i] = { status: 'error', project: files[i].name, error: e.message };
    }
    _repaint();
  }

  const ok   = xlsState.batchResults.filter(r => r.status === 'ok').length;
  const warn = xlsState.batchResults.filter(r => r.status === 'warn').length;
  const err  = xlsState.batchResults.filter(r => r.status === 'error').length;
  const fmtR = v => typeof fmtCurrency === 'function' ? fmtCurrency(v) : 'R$ ' + v;

  result.style.display = 'block';
  result.innerHTML = `
    <div class="alert ${err === files.length ? 'alert-danger' : 'alert-success'}"><div>
      <div class="alert-title">${err === files.length ? '❌' : '✅'} Lote concluído!</div>
      <div class="alert-desc">
        ${ok + warn} projeto(s) importados · ${totalTasks} ação(ões) no total
        ${warn ? ` · ${warn} com avisos` : ''}${err ? ` · ${err} com erro(s)` : ''}
        ${totalBudget > 0 ? ` · Orçamento consolidado: ${fmtR(totalBudget)}` : ''}
      </div>
    </div></div>`;

  toast(`${ok + warn} projeto(s) importados com sucesso!`, ok + warn > 0 ? 'success' : 'error');
  btn.textContent = '✓ Fechar'; btn.disabled = false;
  btn.onclick = () => { closeModal('modal-excel'); loadProjects(); loadDashboard(); };
  setTimeout(() => { loadDashboard(); loadProjects(); }, 600);
}

/* ═══════════════════════════════════════════════════════════════
   HELPER — UPSERT DE PROJETO
═══════════════════════════════════════════════════════════════ */
async function _upsertProject(p) {
  const payload = {
    code:              p.code,
    name:              p.name,
    area:              _normalizeArea(p.area) || null,
    manager_name_text: p.manager || null,
    start_date:        p.start_date || null,
    end_date:          p.end_date   || null,
    budget:            p.budget     || 0,
    status:            'Em andamento',
    priority:          'Alta',
  };
  try {
    // 1. Busca por código (sem filtro de departamento)
    const existing = await GET('/projects/by-code/' + encodeURIComponent(p.code)).catch(() => null);
    if (existing && existing.id) {
      // Projeto já existe — atualiza
      await PUT('/projects/' + existing.id, payload).catch(() => {});
      return existing.id;
    }

    // 2. Cria novo projeto
    const res = await POST('/projects', payload);
    if (!res || !res.id) throw new Error('Servidor não retornou ID do projeto');
    return res.id;
  } catch (e) {
    throw new Error('Falha ao salvar projeto "' + p.name + '": ' + e.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
   DOWNLOAD DO TEMPLATE
═══════════════════════════════════════════════════════════════ */
function xlsDownloadTemplate() {
  if (typeof XLSX === 'undefined') { toast('Biblioteca XLSX não disponível', 'error'); return; }
  const wb  = XLSX.utils.book_new();
  const aoa = [
    [null],
    [null, '🌿  PMO SUITE — PLANO DE AÇÃO · PLANEJAMENTO ESTRATÉGICO 2026'],
    [null, 'NOME DO PROJETO:', '', 'Nome do Projeto Aqui', '', '', 'ÁREA / DEPARTAMENTO:', '', 'SUPRIMENTOS', '', 'CÓDIGO DO PROJETO: PMO-001', ''],
    [null, 'GESTOR DO PROJETO:', '', 'Nome do Gestor', '', '', 'DATA DE INÍCIO DO PROJETO:', '', '01/01/2026', '', 'DATA DE TÉRMINO DO PROJETO: 31/12/2026', ''],
    [null],
    [null, 'CÓDIGO\nEAP', 'AÇÃO / ENTREGÁVEL', 'RESPONSÁVEL', 'PRIORIDADE', 'STATUS', 'INÍCIO', 'TÉRMINO', 'PROGRESSO\n(%)', 'CUSTO\nESTIMADO (R$)', 'CUSTO\nREALIZADO (R$)', 'OBSERVAÇÕES'],
    [null, '1', '1. Primeiro Objetivo Estratégico', null, 'Alta', 'Em andamento', '01/01/2026', '31/12/2026', null, null, null, 'Observação do objetivo'],
    [null, '1.1', '1.1. Primeira ação do objetivo', 'Responsável A', 'Alta', 'Não iniciado', '01/02/2026', '31/03/2026', '0%', '10000', '0', 'Observação da ação'],
    [null, '1.2', '1.2. Segunda ação', 'Responsável B', 'Média', 'Não iniciado', '01/04/2026', '30/06/2026', '0%', '5000', '0', ''],
    [null, '2', '2. Segundo Objetivo Estratégico', null, 'Alta', 'Em andamento', '01/01/2026', '31/12/2026', null, null, null, ''],
    [null, '2.1', '2.1. Ação do segundo objetivo', 'Responsável C', 'Média', 'Não iniciado', '01/03/2026', '31/05/2026', '0%', '8000', '0', ''],
    [null, 'TOTAL DO PROJETO', null, null, null, null, null, null, null, '23000', '0', null],
    [null],
    [null, 'ℹ  Código inteiro (1, 2) = objetivo estratégico  |  Com ponto (1.1, 2.3) = ação executável'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [3, 10, 34, 20, 12, 14, 12, 12, 12, 16, 16, 22].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'MODELO');
  XLSX.writeFile(wb, 'PMO_PlanoDeAcao_Template.xlsx');
  toast('Template baixado!', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS — PARSING INTERNO
═══════════════════════════════════════════════════════════════ */

/** Remove acentos para comparação robusta de labels */
function _norm(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

/** Lê célula de forma segura */
function _g(row, colIdx) {
  if (colIdx === -1 || !row || row[colIdx] == null) return '';
  return String(row[colIdx]).trim();
}

/** Normaliza nome de área/departamento para o padrão do sistema */
function _normalizeArea(v) {
  if (!v) return v;
  const s = v.trim();
  const map = {
    // T.I
    'ti': 'T.I', 't.i': 'T.I', 'tecnologia da informação': 'T.I',
    'tecnologia da informacao': 'T.I', 'tecnologia': 'T.I', 'informática': 'T.I',
    'informatica': 'T.I', 'it': 'T.I',
    // Controladoria
    'controladoria': 'Controladoria',
    // D.P / RH
    'd.p': 'D.P', 'dp': 'D.P', 'rh': 'D.P', 'recursos humanos': 'D.P',
    'departamento pessoal': 'D.P', 'depto pessoal': 'D.P',
    // Financeiro BEM
    'financeiro (bem indústrias)': 'Financeiro (Bem Indústrias)',
    'financeiro (bem industrias)': 'Financeiro (Bem Indústrias)',
    'financeiro bem': 'Financeiro (Bem Indústrias)',
    'bem indústrias': 'Financeiro (Bem Indústrias)',
    'bem industrias': 'Financeiro (Bem Indústrias)',
    // Financeiro GSM
    'financeiro (gsm)': 'Financeiro (GSM)', 'financeiro gsm': 'Financeiro (GSM)', 'gsm': 'Financeiro (GSM)',
    // Compras
    'compras': 'Compras', 'compas': 'Compras', 'suprimentos - compras': 'Compras',
    // Suprimentos
    'suprimentos': 'Suprimentos', 'suprimentos - mp': 'Suprimentos',
    'suprimento': 'Suprimentos', 'supply': 'Suprimentos',
    // Produção
    'produção': 'Produção', 'producao': 'Produção', 'producção': 'Produção',
    'produção industrial': 'Produção', 'industrial': 'Produção',
    // Laboratório
    'laboratório': 'Laboratório', 'laboratorio': 'Laboratório', 'lab': 'Laboratório',
    // Logística
    'logística': 'Logística', 'logistica': 'Logística', 'logistica': 'Logística',
    // Administrativo
    'administrativo': 'Administrativo', 'admin': 'Administrativo', 'administração': 'Administrativo',
    'administracao': 'Administrativo',
    // Comercial
    'comercial': 'Comercial', 'vendas': 'Comercial', 'sales': 'Comercial',
    // Marketing
    'marketing': 'Marketing',
  };
  const key = s.toLowerCase().trim();
  return map[key] || s; // retorna o mapeado ou o original
}

/** Remove quebras de linha e espaços extras */
function _clean(v) {
  if (v == null) return '';
  return String(v).replace(/[\n\r\t]/g, ' ').trim();
}

/** Encontra índice de coluna pelo primeiro keyword que combinar */
function _findCol(headerArr, keywords) {
  const idx = headerArr.findIndex(h => keywords.some(k => h.includes(k)));
  return idx !== -1 ? idx : -1;
}

/**
 * Determina nível EAP:
 *   "1"       → nível 1  (objetivo)
 *   "1.1"     → nível 2  (ação)
 *   "1.1.1"   → nível 3  (sub-ação)
 */
function _calcEapLevel(code) {
  if (!code) return 2;
  const s = String(code).trim();
  return s.includes('.') ? s.split('.').length : 1;
}

/**
 * Converte qualquer formato de data para YYYY-MM-DD.
 * Suporta: ISO, BR (DD/MM/YYYY), serial Excel, timestamp Python (2026-03-30 00:00:00)
 */
function _parseDate(v) {
  if (!v) return null;
  let s = String(v).trim();

  // Timestamp Python: "2026-03-30 00:00:00"
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 10);

  // ISO puro: "2026-03-30"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // BR com / ou -: "30/03/2026" ou "30-03-2026"
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (br) {
    let [, d, m, y] = br;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // Serial numérico do Excel (ex: 46375)
  if (/^\d+$/.test(s) && +s > 40000 && +s < 60000) {
    try { return new Date((+s - 25569) * 86400000).toISOString().slice(0, 10); } catch { /**/ }
  }

  // Fallback via Date.parse
  try { const d = new Date(s); if (!isNaN(d)) return d.toISOString().slice(0, 10); } catch { /**/ }
  return null;
}

function _parseProgress(v) {
  if (v === null || v === undefined || v === '') return 0;
  return Math.min(100, Math.max(0, parseFloat(String(v).replace('%', '').replace(',', '.')) || 0));
}

function _parseMoney(v) {
  if (!v) return 0;
  return parseFloat(String(v).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
}

function _mapStatus(v) {
  const m = {
    'concluído':'Concluído','concluido':'Concluído','done':'Concluído','finalizado':'Concluído',
    'em andamento':'Em andamento','andamento':'Em andamento','ativo':'Em andamento',
    'em execução':'Em andamento','em execucao':'Em andamento',
    'atrasado':'Atrasado','delayed':'Atrasado',
    'não iniciado':'Planejado','nao iniciado':'Planejado','planejado':'Planejado',
    'em espera':'Em espera','aguardando':'Em espera','suspenso':'Em espera','em pausa':'Em espera',
    'cancelado':'Cancelado','cancelada':'Cancelado',
  };
  return m[_clean(v).toLowerCase()] || 'Planejado';
}

function _mapPriority(v) {
  const l = _clean(v).toLowerCase();
  if (['alta','high','crítica','critica','urgente'].includes(l)) return 'Alta';
  if (['baixa','low'].includes(l)) return 'Baixa';
  return 'Média';
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS — DOM
═══════════════════════════════════════════════════════════════ */
function _show(id) { const el = document.getElementById(id); if (el) el.style.display = 'block'; }
function _hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function _setBtnNext(enabled, text, handler) {
  const btn = document.getElementById('xls-btn-next');
  if (!btn) return;
  btn.disabled = !enabled; btn.textContent = text;
  if (handler !== null) btn.onclick = handler;
}
