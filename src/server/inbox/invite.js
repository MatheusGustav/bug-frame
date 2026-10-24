const config = JSON.parse(document.body.dataset.config);
let token = new URLSearchParams(location.hash.slice(1)).get('token');
// The secret stays out of HTTP URLs, referrers, persistent browser storage, and subsequent history.
history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
$('start').href = config.siteUrl; $('requests').href = config.basePath + '/review';
if (config.loginUrl) { $('login').href = config.loginUrl; $('sign-in').hidden = false; }
if (!token) { $('message').textContent = 'Reopen the original invitation link to continue.'; $('accept').disabled = true; }
$('accept').addEventListener('click', async () => {
  $('accept').disabled = true;
  try {
    const response = await fetch(config.apiBase + '/invitations/accept', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (!response.ok) {
      $('message').textContent = response.status === 401 ? 'Sign in with your invited account, then try again.' : response.status === 429 ? 'Please wait before trying again.' : 'This invitation is unavailable or does not match your verified email. Ask your developer for help.';
      $('accept').disabled = false; return;
    }
    token = null; $('accept').hidden = true; $('sign-in').hidden = true; $('next').hidden = false;
    $('message').textContent = 'You’re ready. Open the website and frame anything you would like to improve.';
  } catch { $('message').textContent = 'Could not reach the server. Please try again.'; $('accept').disabled = false; }
});
window.addEventListener('pagehide', () => { token = null; $('accept').disabled = true; });
