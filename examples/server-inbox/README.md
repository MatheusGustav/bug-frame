# Persistent server reporting and private inbox

This portable example combines the authenticated Bugframe API, optional administrator inbox, private filesystem storage,
and a small demo page. It uses Node's standard library and the existing Bugframe authorization contract, with no hosting
vendor, customer identity, domain, or production credentials embedded in source.

Build the widget first: `npm ci --ignore-scripts && npm run build` (development Node 20+). Start from the repository/package
root with an absolute data directory outside the source deployment and public/static directories:

```bash
BUGFRAME_DATA_DIR=/absolute/private/bugframe \
BUGFRAME_ORIGIN=https://your-domain.example \
BUGFRAME_AUTH_MODULE=/absolute/private/bugframe-auth.mjs \
HOST=127.0.0.1 PORT=4455 node examples/server-inbox/server.mjs
```

The auth module exports `authorize(request)` and verifies your application's existing login session and current permissions;
see [authentication](../authentication/README.md). Set `BUGFRAME_LOGIN_URL=/your-login` for the inbox's sign-in link and
`BUGFRAME_SITE_NAME` for its title. Approved accounts can report, while only admins can open `/bugs/` and manage progress or invitations. With an auth module, invitations are enabled: return `role: 'user'` plus verified account email for invitation-only customers. Approved customers use `/bugs/review`; the invitation shell is `/bugs/invite`. Account creation, email verification, and sign-in remain part of your application.
Use a same-origin HTTPS reverse proxy for `/api/bugframe`, `/bugs`, and the application's cookie/session handling. This
example serves only its own demo/login assets; integrate its handlers before your framework's static-site handler, never
mount the private data directory as a static folder. `BUGFRAME_ADMIN_TOKEN` optionally enables private remote agent access.
Without an auth module, browser access stays denied even when an admin API credential is set.

## Optional single-owner session demonstration

For a local evaluation without an existing account system, explicitly opt in:

```bash
BUGFRAME_DATA_DIR=/absolute/private/bugframe \
BUGFRAME_ORIGIN=http://127.0.0.1:4455 BUGFRAME_OWNER_DEMO=1 \
node examples/server-inbox/server.mjs
```

Open `/owner`, retrieve `adminToken` from the server's private `owner-access.json` through your own server file manager, and
sign in. The key is randomly generated once (256 bits) with file mode 0600 and is never printed in runtime logs. An environment
`BUGFRAME_ADMIN_TOKEN` of at least 32 random characters can override it. The inbox is at `/bugs/`; the demo page is at `/?bugs=1`.
The browser widget uses server mode, error capture, and `allowDownloadFallback: false`.

This is one owner identity, not a multi-user account system: it has no invitations, individual reporting permissions, recovery,
or shared sessions across instances. It cannot be combined with `BUGFRAME_AUTH_MODULE`, so opting into the example never
silently broadens your production account policy. Reuse existing app authentication for real user accounts.

The example's routes are `GET/POST/DELETE /owner/session`: sign-in uses JSON `{ key }` and same-origin checks. Only SHA-256
digests of random browser session tokens are retained server-side. Sessions expire after eight hours and use HttpOnly,
SameSite=Strict cookies, with Secure on HTTPS. Sign-out revokes immediately; a restart revokes all browser sessions. Sign-in
allows five attempts per IP per fifteen minutes. Limits and sessions are per process; use your application's shared store
when running multiple instances. Public hosting requires HTTPS; HTTP is accepted only for loopback evaluation.

## Persistent data and permissions

```text
BUGFRAME_DATA_DIR/
  owner-access.json          optional generated owner credential; private
  reports/<id>/report.json   description, context, status and note
  reports/<id>/region.png    selected area
  reports/.invitations/      private email-bound invitation records (hashes, never raw invitation tokens)
  reports/<id>/full.png      captured viewport
  events.ndjson             report-created id/timestamp events (no descriptions, keys or screenshots)
```

Keep this folder on a persistent volume outside release/build directories so deployments replace code without deleting
reports. New directories/files use 0700/0600; existing permissions are not silently rewritten, so check them before reusing
an older folder. The filesystem CLI uses `--dir "$BUGFRAME_DATA_DIR/reports"`; remote agents use the hosted API instead.
Use one server process/writer per directory for invitation and review coordination. Back up the entire private data folder separately from source deployments. Encrypt and restrict backups, set an appropriate
retention period for reports/images/event logs, and remove expired data/backups according to your own retention policy.
Reports already loaded in a browser cannot be recalled; sign-out should destroy the widget and refresh open inboxes.

Rotate the private admin key and restart the runtime, then update the agent's private credential. For the optional owner
demo, replace the private key file or keep a permanent environment override. Removing an override reactivates the key in
that file, so replace it too when retiring an old credential. A restart invalidates every in-memory owner session while
leaving reports intact. Verify `/health` and a private report after upgrades; rollback can restore v0.2.0 server code while
retaining the same report folders, with that version's custom inbox/no-ZIP integration retained if needed.

## Proxy assumptions

Set `BUGFRAME_TRUST_PROXY=1` only if the listener is reachable exclusively through a trusted proxy that replaces untrusted
`X-Forwarded-For` and `X-Forwarded-Proto` headers and preserves the public Host. The adapter uses the first forwarded IP and
protocol only in this mode. Direct public listeners must leave it off. Bind to loopback or firewall the upstream port; set
`HOST=0.0.0.0` only where the hosting runtime requires it and ingress is controlled.

The optional inbox uses a restrictive CSP and safe text rendering. The demo reporting page additionally permits inline
styles because the current widget injects its Shadow DOM styles; script execution remains restricted to same-origin files.
The inbox and API recheck authorization and use no-store responses. General API logs contain method/path/status only;
report-created events contain only id/timestamp. No automatic email, issue creation, agent execution, or deployment is added.

## Migrating a custom integration from 0.2.0

1. Install the released 0.3.0 package and rebuild the browser bundle.
2. Keep your existing login/session checks, data directory, authorization hook, and private agent credentials.
3. Add `mode: 'server', allowDownloadFallback: false` to widget initialization. Remove any build transformation that removes
   the internal `.downloadInstead` action; the public option now enforces that policy.
4. Optionally replace a custom inbox with `createInbox`; retain your own sign-in/sign-out routes. Configure the browser/API
   base paths and only expose the inbox to verified admins. The new `/access` route is a read-only role check, not a login route.
5. Replace a custom agent script with `bugframe --remote https://your-domain.example/api/bugframe list|show|close|reopen`.
   Use a private environment token or a private JSON credential file; never put secrets in the repository or command flags.
6. Back up data, deploy, confirm unauthorized requests are rejected, submit a clearly labeled test report, inspect its actual
   stored screenshots/context, and close it only after that verification. Failed/offline submissions must retain the report
   without downloading a file. Keep the same persistent data folder across source deployments.

Publishing this upstream package does not modify or redeploy an existing website. Follow the migration steps within that
website's own deployment process.
