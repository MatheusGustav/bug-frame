const message = document.getElementById('message');
async function session(method, key) {
  const response = await fetch('/owner/session', { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: key ? JSON.stringify({ key }) : undefined });
  if (!response.ok) throw new Error(`Access request failed (${response.status}). Check the key or wait before retrying.`);
}
document.getElementById('login').addEventListener('submit', async event => {
  event.preventDefault(); event.submitter.disabled = true;
  try { await session('POST', document.getElementById('key').value); document.getElementById('key').value = ''; location.assign('/bugs/'); }
  catch (error) { message.textContent = error.message; } finally { event.submitter.disabled = false; }
});
document.getElementById('logout').addEventListener('click', async () => {
  try { await session('DELETE'); message.textContent = 'Signed out. This browser session has been revoked.'; } catch (error) { message.textContent = error.message; }
});
