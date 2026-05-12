/**
 * PMO Suite — Serviço de Email (Resend)
 * ─────────────────────────────────────
 * Envia notificações automáticas para até 3 destinatários configurados.
 *
 * Configurar no .env:
 *   RESEND_API_KEY=re_xxxxxxxxxxxx
 *   NOTIFY_EMAILS=email1@empresa.com,email2@empresa.com,email3@empresa.com
 *   NOTIFY_FROM=PMO Suite <noreply@seudominio.com>
 */

let _resend = null;

function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) return null;
    const { Resend } = require('resend');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

function getRecipients() {
  const emails = process.env.NOTIFY_EMAILS || '';
  return emails.split(',').map(e => e.trim()).filter(Boolean).slice(0, 3);
}

const FROM = () => process.env.NOTIFY_FROM || 'PMO Suite <onboarding@resend.dev>';

/* ── Template base ── */
function _baseTemplate(title, content, color = '#2E7D32') {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#1B5E20,${color});padding:32px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:22px;font-weight:700}
  .header p{color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px}
  .body{padding:28px 32px}
  .body p{color:#424242;font-size:14px;line-height:1.6;margin:0 0 12px}
  .card{background:#F1F8E9;border-left:4px solid ${color};border-radius:6px;padding:16px;margin:16px 0}
  .card strong{color:#1B5E20;display:block;margin-bottom:4px;font-size:13px}
  .card span{color:#424242;font-size:14px}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${color};color:#fff}
  .footer{padding:20px 32px;background:#FAFAFA;border-top:1px solid #EEE;text-align:center;font-size:11px;color:#9E9E9E}
  .btn{display:inline-block;background:${color};color:#fff;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>🌿 PMO Suite</h1>
    <p>${title}</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    PMO Suite v5.0 · Notificação automática · ${new Date().toLocaleDateString('pt-BR')}<br>
    Este email foi gerado automaticamente. Não responda.
  </div>
</div>
</body></html>`;
}

/* ── Funções de envio ── */

async function sendEmail({ to, subject, html }) {
  const resend = getResend();
  if (!resend) {
    console.log(`[email] RESEND_API_KEY não configurado. Email não enviado: ${subject}`);
    return false;
  }
  try {
    const recipients = Array.isArray(to) ? to : [to];
    if (!recipients.length) return false;
    await resend.emails.send({ from: FROM(), to: recipients, subject, html });
    console.log(`[email] ✅ Enviado: "${subject}" → ${recipients.join(', ')}`);
    return true;
  } catch (e) {
    console.error(`[email] ❌ Erro ao enviar "${subject}": ${e.message}`);
    return false;
  }
}

/* ── Notificações específicas ── */

async function notifyProjectDelayed(project) {
  const to = getRecipients();
  if (!to.length) return;
  const html = _baseTemplate(
    'Projeto com prazo vencido',
    `<p>O projeto abaixo está com status <span class="badge">Atrasado</span> e requer atenção.</p>
    <div class="card">
      <strong>Projeto</strong><span>${project.name} [${project.code}]</span>
    </div>
    <div class="card">
      <strong>Área</strong><span>${project.area || '—'}</span>
    </div>
    <div class="card">
      <strong>Progresso atual</strong><span>${project.progress || 0}%</span>
    </div>
    <div class="card">
      <strong>Data de término prevista</strong><span>${project.end_date || '—'}</span>
    </div>
    <p>Acesse o sistema para registrar um update ou solicitar revisão de prazo.</p>`,
    '#C62828'
  );
  await sendEmail({ to, subject: `⚠️ Projeto Atrasado: ${project.name}`, html });
}

async function notifyTaskExpiring(task, project) {
  const to = getRecipients();
  if (!to.length) return;
  const daysLeft = task.end_date
    ? Math.ceil((new Date(task.end_date) - new Date()) / 86400000)
    : null;
  const html = _baseTemplate(
    'Tarefa com prazo próximo',
    `<p>A ação abaixo vence em <strong>${daysLeft !== null ? daysLeft + ' dia(s)' : 'breve'}</strong> e ainda não foi concluída.</p>
    <div class="card">
      <strong>Ação</strong><span>${task.eap_code ? '[' + task.eap_code + '] ' : ''}${task.name}</span>
    </div>
    <div class="card">
      <strong>Projeto</strong><span>${project?.name || '—'} — ${project?.area || '—'}</span>
    </div>
    <div class="card">
      <strong>Responsável</strong><span>${task.assignee_name || 'Não definido'}</span>
    </div>
    <div class="card">
      <strong>Prazo</strong><span>${task.end_date || '—'} · Progresso: ${task.progress || 0}%</span>
    </div>`,
    '#E65100'
  );
  await sendEmail({ to, subject: `⏰ Prazo próximo: ${task.name}`, html });
}

async function notifyWeeklyReport(stats) {
  const to = getRecipients();
  if (!to.length) return;
  const html = _baseTemplate(
    'Resumo Semanal do Portfólio',
    `<p>Aqui está o resumo do portfólio PMO desta semana.</p>
    <div class="card">
      <strong>Total de Projetos</strong><span>${stats.total || 0}</span>
    </div>
    <div class="card">
      <strong>Em Andamento</strong><span>${stats.active || 0}</span>
    </div>
    <div class="card" style="border-color:#C62828;background:#FFF3E0">
      <strong>Atrasados</strong><span style="color:#C62828;font-weight:600">${stats.delayed || 0}</span>
    </div>
    <div class="card">
      <strong>Concluídos</strong><span>${stats.done || 0}</span>
    </div>
    <div class="card">
      <strong>Progresso Médio</strong><span>${stats.avg_progress || 0}%</span>
    </div>
    <p>Acesse o sistema para ver o relatório completo por departamento.</p>`
  );
  await sendEmail({ to, subject: `📊 Resumo Semanal PMO — ${new Date().toLocaleDateString('pt-BR')}`, html });
}

async function notifyRiskCritical(risk, project) {
  const to = getRecipients();
  if (!to.length) return;
  const sev = (risk.probability || 1) * (risk.impact || 1);
  const html = _baseTemplate(
    'Risco crítico identificado',
    `<p>Um risco com <strong>severidade ${sev}</strong> foi detectado e requer ação imediata.</p>
    <div class="card" style="border-color:#C62828;background:#FFF3E0">
      <strong>Risco ${risk.code || ''}</strong><span>${risk.description}</span>
    </div>
    <div class="card">
      <strong>Projeto</strong><span>${project?.name || '—'} — ${project?.area || '—'}</span>
    </div>
    <div class="card">
      <strong>Probabilidade × Impacto</strong><span>${risk.probability} × ${risk.impact} = <strong>${sev}</strong></span>
    </div>
    <div class="card">
      <strong>Mitigação definida</strong><span>${risk.mitigation || 'Não definida ⚠️'}</span>
    </div>`,
    '#C62828'
  );
  await sendEmail({ to, subject: `🔴 Risco Crítico (${sev}): ${project?.name || '—'}`, html });
}

module.exports = {
  sendEmail,
  notifyProjectDelayed,
  notifyTaskExpiring,
  notifyWeeklyReport,
  notifyRiskCritical,
  getRecipients,
};
