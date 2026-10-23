const $ = id => document.getElementById(id);
const { apiBase, labels } = JSON.parse(document.body.dataset.config);
for (const element of document.querySelectorAll('[data-label]')) if (labels[element.dataset.label]) element.textContent = labels[element.dataset.label];
let selectedId;
const images = new Map();
const message = text => { $('message').textContent = text; };
const releaseImages = () => {
  for (const url of images.values()) URL.revokeObjectURL(url);
  images.clear();
  for (const name of ['region', 'full']) { $(name).removeAttribute('src'); $(name).hidden = true; }
};
const clearPrivateContent = () => {
  selectedId = null; releaseImages(); $('detail').hidden = true; $('reports').replaceChildren();
  for (const id of ['description', 'info', 'context']) $(id).textContent = '';
  $('note').value = ''; $('page-link').removeAttribute('href');
};
async function request(route, options = {}) {
  const access = await fetch(apiBase + '/access', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  if (!access.ok || (await access.json()).role !== 'admin') {
    clearPrivateContent(); throw new Error('An authorized administrator session is required. Sign in and retry.');
  }
  const response = await fetch(apiBase + route, { ...options, credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/json' } });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearPrivateContent();
    throw new Error(`Request failed (HTTP ${response.status}). Check your administrator session and retry.`);
  }
  return response;
}
async function refresh() {
  const { reports } = await (await request('/reports?all=1')).json();
  $('reports').replaceChildren(); $('empty').hidden = reports.length > 0;
  for (const report of reports) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `[${report.status}] ${report.description}`;
    button.dataset.reportId = report.id;
    button.setAttribute('aria-current', String(report.id === selectedId));
    button.addEventListener('click', () => show(report.id).catch(error => message(error.message)));
    const item = document.createElement('li'); item.append(button); $('reports').append(item);
  }
}
async function show(id) {
  selectedId = id; releaseImages(); $('detail').hidden = true;
  for (const button of $('reports').querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.reportId === id));
  const report = await (await request('/reports/' + encodeURIComponent(id))).json();
  if (selectedId !== id) return;
  $('detail').hidden = false; $('choose').hidden = true;
  $('description').textContent = report.description; $('description').focus();
  $('info').textContent = `${report.id} · ${report.createdAt} · ${report.context.viewport?.w ?? '?'} × ${report.context.viewport?.h ?? '?'}`;
  $('page-link').hidden = true; $('page-link').removeAttribute('href');
  try {
    const page = new URL(report.context.url);
    if (['https:', 'http:'].includes(page.protocol) && !page.username && !page.password) { $('page-link').href = page.href; $('page-link').hidden = false; }
  } catch { /* malformed report links remain hidden */ }
  $('context').textContent = JSON.stringify(report.context, null, 2);
  $('status').value = report.status; $('note').value = report.note;
  for (const name of ['region', 'full']) {
    const response = await request(`/reports/${encodeURIComponent(id)}/${name}.png`);
    if (selectedId !== id) return;
    const blob = await response.blob();
    if (selectedId !== id || blob.type !== 'image/png') continue;
    const url = URL.createObjectURL(blob); images.set(name, url); $(name).src = url; $(name).hidden = false;
  }
}
$('status-form').addEventListener('submit', async event => {
  event.preventDefault(); const id = selectedId;
  if (!id) return;
  if ($('status').value !== 'open' && !$('note').value.trim()) { message('Add a note explaining the resolution.'); $('note').focus(); return; }
  $('save').disabled = true;
  try {
    await request('/reports/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: $('status').value, note: $('note').value }) });
    message('Status saved.'); await refresh();
  } catch (error) { message(error.message); } finally { $('save').disabled = false; }
});
$('refresh').addEventListener('click', () => refresh().catch(error => message(error.message)));
window.addEventListener('pagehide', clearPrivateContent);
window.addEventListener('pageshow', event => { if (event.persisted) refresh().catch(error => message(error.message)); });
refresh().catch(error => message(error.message));
