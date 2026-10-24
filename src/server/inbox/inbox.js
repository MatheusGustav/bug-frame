const $ = id => document.getElementById(id);
const { apiBase, labels, customer, basePath, siteUrl, invitations } = JSON.parse(document.body.dataset.config);
for (const element of document.querySelectorAll('[data-label]')) if (labels[element.dataset.label]) element.textContent = labels[element.dataset.label];
$('site-link').href = siteUrl;
if (customer) { document.querySelector('.eyebrow').textContent = 'MY REQUESTS'; $('intro').textContent = 'Leave feedback on the website, follow its progress, and approve the result.'; }
$('invitations-panel').hidden = customer || !invitations;
let selectedId, selectedReport, rows = [], generation = 0;
const images = new Map();
const statusName = { open: 'Submitted', reviewed: 'Reviewed', in_progress: 'In progress', ready_for_review: 'Ready for your review', changes_requested: 'Adjustment requested', approved: 'Approved', fixed: 'Fixed', wontfix: 'Not planned' };
const kindName = { bug: 'Something isn’t working', content: 'Content change', design: 'Design improvement', idea: 'New idea' };
const dateLabel = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
if (customer) { $('history-panel').open = false; $('screenshots-panel').open = false; }
const message = text => { $('message').textContent = text; };
const releaseImages = () => {
  for (const url of images.values()) URL.revokeObjectURL(url);
  images.clear();
  for (const name of ['region', 'full']) { $(name).removeAttribute('src'); $(name).hidden = true; }
};
const clearPrivateContent = () => {
  generation++; selectedId = null; selectedReport = null; rows = []; releaseImages(); $('detail').hidden = true; $('reports').replaceChildren();
  for (const id of ['description', 'info', 'context', 'resolution', 'customer-note', 'current-text', 'suggested-text', 'invite-expiry']) $(id).textContent = '';
  for (const id of ['note', 'adjustment', 'invite-link', 'invite-email']) $(id).value = '';
  $('invitations').replaceChildren(); $('activity').replaceChildren(); $('invite-result').hidden = true;
  for (const id of ['page-link', 'review-page']) $(id).removeAttribute('href');
};
async function request(route, options = {}) {
  const access = await fetch(apiBase + '/access', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  if (!access.ok || (!customer && (await access.json()).role !== 'admin')) {
    clearPrivateContent(); throw new Error(customer ? 'Your feedback access has expired. Sign in or ask your developer for a new invitation.' : 'An authorized administrator session is required. Sign in and retry.');
  }
  const response = await fetch(apiBase + route, { ...options, credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/json' } });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearPrivateContent();
    throw new Error(response.status === 409 ? (route.startsWith('/invitations') ? 'This customer already has an active invitation. Revoke it before creating another.' : 'This review changed. Refresh before responding.') : `Request failed (HTTP ${response.status}). Check your session and retry.`);
  }
  return response;
}
async function refresh() {
  const version = generation;
  const { reports } = await (await request(customer ? '/reports' : '/reports?all=1')).json();
  if (version !== generation) return;
  rows = reports; $('reports').replaceChildren(); $('empty').hidden = reports.length > 0;
  for (const report of reports) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${statusName[report.status] ?? report.status} · ${kindName[report.kind ?? 'bug'] ?? 'Feedback'} — ${report.description}`;
    button.dataset.reportId = report.id; button.setAttribute('aria-current', String(report.id === selectedId));
    button.addEventListener('click', () => show(report.id).catch(error => message(error.message)));
    const item = document.createElement('li'); item.append(button); $('reports').append(item);
  }
}
function safePage(report) {
  try {
    const raw = customer ? report.page : report.context.url;
    if (customer && (!raw?.startsWith('/') || raw.startsWith('//'))) return null;
    const page = new URL(raw, location.origin);
    if (['https:', 'http:'].includes(page.protocol) && !page.username && !page.password && (!customer || page.origin === location.origin)) return page.href;
  } catch { /* malformed report links stay hidden */ }
  return null;
}
async function show(id) {
  selectedId = id; selectedReport = null; releaseImages(); $('detail').hidden = true;
  const version = generation;
  for (const button of $('reports').querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.reportId === id));
  const report = customer ? rows.find(row => row.id === id) : await (await request('/reports/' + encodeURIComponent(id))).json();
  if (!report || selectedId !== id || version !== generation) return;
  selectedReport = report; $('detail').hidden = false; $('choose').hidden = true;
  $('description').textContent = report.description; $('description').focus();
  $('info').textContent = `${statusName[report.status] ?? report.status} · ${kindName[report.kind ?? 'bug']} · ${dateLabel(report.createdAt)}${customer ? '' : ` · ${report.id} · ${report.context.viewport?.w ?? '?'} × ${report.context.viewport?.h ?? '?'}`}`;
  const page = safePage(report);
  for (const id of ['page-link', 'review-page']) { $(id).hidden = !page; $(id).removeAttribute('href'); if (page) $(id).href = page; }
  $('context').textContent = customer ? '' : JSON.stringify(report.context, null, 2);
  $('technical').hidden = customer; $('status-form').hidden = customer;
  $('status').value = report.status; $('note').value = report.note; $('save').disabled = report.status === 'approved';
  $('resolution').textContent = report.note ? `Developer: ${report.note}` : '';
  $('customer-note').textContent = report.reviewNote ? `Customer: ${report.reviewNote}` : '';
  $('wording').hidden = report.kind !== 'content'; $('current-text').textContent = report.currentText || '—'; $('suggested-text').textContent = report.suggestedText || '—';
  $('activity').replaceChildren();
  for (const event of report.activity ?? []) {
    const item = document.createElement('li'); item.textContent = `${statusName[event.status] ?? event.status} · ${event.by} · ${dateLabel(event.at)}${event.note ? ` — ${event.note}` : ''}`; $('activity').append(item);
  }
  $('review-form').hidden = !customer || report.status !== 'ready_for_review'; $('adjustment').value = '';
  for (const name of ['region', 'full']) {
    const response = await request(`/reports/${encodeURIComponent(id)}/${name}.png`);
    const blob = await response.blob();
    if (selectedId !== id || version !== generation || blob.type !== 'image/png') return;
    const url = URL.createObjectURL(blob); images.set(name, url); $(name).src = url; $(name).hidden = false;
  }
}
$('status').addEventListener('change', () => { $('save').disabled = $('status').value === 'approved'; });
$('status-form').addEventListener('submit', async event => {
  event.preventDefault(); const id = selectedId;
  if (!id) return;
  if ($('status').value !== 'open' && !$('note').value.trim()) { message('Add a note explaining the update.'); $('note').focus(); return; }
  $('save').disabled = true;
  try {
    await request('/reports/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: $('status').value, note: $('note').value }) });
    message('Status saved.'); await refresh(); await show(id);
  } catch (error) { message(error.message); } finally { $('save').disabled = $('status').value === 'approved'; }
});
async function respond(action) {
  const report = selectedReport; if (!report) return;
  if (action === 'request_changes' && !$('adjustment').value.trim()) { $('adjustment').focus(); message('Describe what still needs adjustment.'); return; }
  $('approve').disabled = $('request-changes').disabled = true;
  try {
    await request(`/reports/${encodeURIComponent(report.id)}/review`, { method: 'POST', body: JSON.stringify({ action, reviewVersion: report.reviewVersion, note: $('adjustment').value }) });
    message(action === 'approve' ? 'Approved. Thank you!' : 'Your adjustment request was sent.'); await refresh(); await show(report.id);
  } catch (error) { message(error.message); } finally { $('approve').disabled = $('request-changes').disabled = false; }
}
$('approve').addEventListener('click', () => respond('approve'));
$('review-form').addEventListener('submit', event => { event.preventDefault(); void respond('request_changes'); });
async function loadInvitations() {
  if (customer || !invitations) return;
  const version = generation;
  const result = await (await request('/invitations')).json();
  if (version !== generation) return;
  $('invitations').replaceChildren();
  for (const invitation of result.invitations) {
    const item = document.createElement('li'), revoke = document.createElement('button');
    const expired = Date.parse(invitation.expiresAt) <= Date.now();
    item.textContent = `${invitation.email} · ${expired ? 'expired' : invitation.status} · access ends ${new Date(invitation.expiresAt).toLocaleString()} `;
    if (!expired && invitation.status !== 'revoked') {
      revoke.type = 'button'; revoke.textContent = 'Revoke access';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try { await request(`/invitations/${invitation.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) }); await loadInvitations(); }
        catch (error) { message(error.message); revoke.disabled = false; }
      }); item.append(revoke);
    }
    $('invitations').append(item);
  }
}
$('invite-form').addEventListener('submit', async event => {
  event.preventDefault(); const version = generation; $('create-invite').disabled = true;
  try {
    const invitation = await (await request('/invitations', { method: 'POST', body: JSON.stringify({ email: $('invite-email').value, expiresInDays: Number($('invite-days').value) }) })).json();
    if (version !== generation) return;
    const url = new URL(basePath + '/invite', location.origin); url.hash = new URLSearchParams({ token: invitation.token }).toString();
    $('invite-link').value = url.href; $('invite-expiry').textContent = `Access ends ${new Date(invitation.expiresAt).toLocaleString()}. This link is shown only once.`; $('invite-result').hidden = false;
    await loadInvitations();
  } catch (error) { message(error.message); } finally { $('create-invite').disabled = false; }
});
async function reload() { await refresh(); if (selectedId) await show(selectedId); await loadInvitations(); }
$('refresh').addEventListener('click', () => { message(''); void reload().catch(error => message(error.message)); });
window.addEventListener('pagehide', clearPrivateContent);
window.addEventListener('pageshow', event => { if (event.persisted) reload().catch(error => message(error.message)); });
reload().catch(error => message(error.message));
