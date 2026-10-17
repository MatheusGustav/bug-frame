# Approved users only

Bugframe 0.2.0 denies report submissions, lists, and screenshots unless the server verifies an approved account or an admin
credential. Merely signing in as an ordinary customer does not confer reporting permission. Missing, expired, revoked, or
unverifiable sessions are rejected before reading or saving the report body.

## Connect your website's login

Configure `authorize(request)` using your existing server-side session service. This is the integration contract;
`verifySession` below is supplied by your application, not by Bugframe:

```js
import { createBugframe } from 'bugframe/server';
import { verifySession } from './your-app/auth.mjs';

export async function authorize(request) {
  // Verify the real cookie/bearer credential, expiry and revocation using your auth provider or session database.
  // Load current permission from trusted server data. Do not decode an unsigned token or trust a role/id header.
  const session = await verifySession(request);
  if (!session?.user) return null;
  const user = session.user;
  if (user.disabled) return null;
  const id = String(user.id); // include the tenant id here if account ids are only unique within a tenant
  if (user.role === 'admin') return { id, role: 'admin' };
  if (user.canReportBugs === true) return { id, role: 'client' };
  return null; // signed-in ordinary customers also get denied
}

export const bf = createBugframe({
  dir: './bug-reports', basePath: '/api/bugframe', authorize,
  adminToken: process.env.BUGFRAME_ADMIN_TOKEN, // optional ops credential; never include this in a browser
});
```

`authorize` must return `{ id: 'stable-account-id', role: 'client' | 'admin' }`, or `null`/`false` to deny. It runs for every
report API request. Returning a boolean or the old strings `'client'`/`'admin'` does not grant access. Keep account ids stable,
nonempty, and at most 256 characters. The server hashes the verified id for ownership and ignores `x-bugframe-reporter`.
If admin bearer credentials are configured, they are verified independently for server-side operations.

Only initialize the browser widget when your UI knows the current user has reporting permission. Use the same-origin API
so your existing HttpOnly login cookie accompanies requests automatically. Recreate or destroy the widget when the account
changes or logs out, to discard screenshots and report previews already loaded in that browser. Server authorization still
applies if a visitor changes the URL, localStorage, JavaScript, widget metadata, or reporter headers.

For cookie sessions, use HTTPS and Secure/HttpOnly/SameSite cookies in production, verify expiry/revocation, and keep the
report API on the same origin. The API requires `application/json` and rejects unapproved browser origins. If your auth
framework needs an additional CSRF token, send it with the widget's custom `fetch` and verify it in `authorize`.
Origin restrictions are an additional browser control; they do not authenticate a user.

## Standalone CLI or framework examples

Put only the `authorize` function and your session-service import in `bugframe-auth.mjs`, then run:

```bash
BUGFRAME_AUTH_MODULE=/absolute/path/to/bugframe-auth.mjs npx bugframe serve --dir ./bug-reports
```

The Express example uses `examples/auth-module.mjs` to load that same function. Keep this helper next to the
copied example or replace the import with your own session verifier. The Next.js example imports the verifier directly
from your app's `lib/bugframe-auth.ts`, so its bundler can include it. If no authorizer is configured, browser reporting stays
closed. The CLI also accepts `--auth-module FILE`. With only `BUGFRAME_ADMIN_TOKEN`, the standalone server is admin-only;
do not put that token in the widget. `--client-token` is rejected because a public browser token cannot authorize a user.

## Local demonstration

Run `npm ci && npm run build && npm run example`, open the printed URL, and follow **Sign in as an approved tester**. Use
the randomly generated password printed in the terminal, or set `BUGFRAME_DEMO_PASSWORD` before starting the server.
The local demo stores opaque, random sessions server-side for one hour and uses an HttpOnly, SameSite=Strict cookie.
Signing out deletes that session immediately. It only binds to localhost, and its password flow is a local demonstration;
production deployments should use their existing account system. No login password or admin credential is embedded in the page.

## Upgrading from 0.1.x

- Upgrade the server and widget to 0.2.0 together and configure `authorize` before enabling reporting.
- `clientTokens`/`data-token` no longer grant access. A public token alone, or no auth configuration, now receives HTTP 401.
- Replace authorization hooks returning strings/booleans with a verified `{ id, role }` principal.
- Existing reports remain available to admins and the filesystem CLI. Old browser-generated reporter ids are not trusted
  as account ownership, so those reports will not appear in a user's new **My reports** list. Migrate ownership only using
  a trusted server-side account mapping; never let a caller claim an old reporter id.
- Rate limits are now applied separately to the verified account and the IP address (10 attempts/minute by default).
  Counters are in-memory per server instance; multi-instance deployments should also enforce shared limits at their gateway.
- ZIP download mode creates local files and has no server access gate. A downloaded ZIP is untrusted input and is accepted
  into your report store only when an operator explicitly imports it with the local CLI. Use server mode for account-controlled submissions.
