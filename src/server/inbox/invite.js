import { languageUI } from './ui.js';
const config = JSON.parse(document.body.dataset.config);
let token = new URLSearchParams(location.hash.slice(1)).get('token');
// The secret stays out of HTTP URLs, referrers, persistent browser storage, and subsequent history.
history.replaceState(null, '', location.pathname + location.search);
const $ = id => document.getElementById(id), ui = languageUI(config);
let messageKey = token ? '' : 'reopenInvite';
const message = key => { messageKey = key; $('message').textContent = key ? ui.t(key) : ''; };
if (config.loginUrl) { $('login').href = config.loginUrl; $('sign-in').hidden = false; }
if (!token) $('accept').disabled = true;
ui.start(() => {
  $('start').href = ui.link(config.siteUrl); $('requests').href = ui.link(config.basePath + '/review');
  message(messageKey);
});
$('accept').addEventListener('click', async () => {
  $('accept').disabled = true;
  try {
    const response = await fetch(config.apiBase + '/invitations/accept', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (!response.ok) {
      message(response.status === 401 ? 'inviteSignIn' : response.status === 429 ? 'waitRetry' : 'inviteUnavailable');
      $('accept').disabled = false; return;
    }
    token = null; $('accept').hidden = true; $('sign-in').hidden = true; $('next').hidden = false;
    message('inviteReady');
  } catch { message('networkFailed'); $('accept').disabled = false; }
});
window.addEventListener('pagehide', () => { token = null; $('accept').disabled = true; });
