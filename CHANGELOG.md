# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project
uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-23

### Added
- Supported `allowDownloadFallback: false` widget policy and script-tag attributes for server-only reporting. Failed/offline
  requests retain the report for retry; explicit ZIP download workflows and default fallback behavior remain available.
- Optional `createInbox` administrator interface with configurable paths/name/labels, private screenshots, safe report rendering,
  status notes, and existing-session authorization. `GET /access` checks the current verified role without creating a session.
- Explicit remote CLI mode for list/show/close/reopen, private environment/file credentials, verified HTTPS, redirect refusal,
  bounded responses and request timeouts. Local CLI behavior remains supported.
- Portable persistent-hosting example with deployment-independent storage, optional single-owner sessions, private key files,
  metadata-only report-created events, and guidance for backups, key rotation, proxy trust, and integration migration.

### Fixed
- Explicit server mode rejects missing/blank endpoints instead of silently producing local ZIP files.
- New filesystem report directories/files use private 0700/0600 permissions, including atomic JSON replacement files.
- Node adapters honor forwarded IP/protocol only with explicit proxy trust and handle comma-separated protocol headers.

### Security / development
- Upgrade the development-only Vitest runner to patched 4.1.12, removing vulnerable mocker/worker-pool dependencies. Runtime
  support stays Node 18.17+; development/widget tests require Node 20+. CI retains native server/CLI checks on Node 18.
- Existing server-verified account permissions, admin restrictions, ownership, and authorization-failure ZIP protections remain enforced.

## [0.2.0] - 2026-10-17

### Security / breaking changes
- Close all report APIs by default. Require a server-verified `{ id, role }` principal or admin credential; public widget
  tokens and legacy string/boolean authorization results no longer grant access.
- Derive report ownership from verified account identity and apply separate account/IP rate limits. Browser reporter ids
  cannot claim another account's reports or reset the account quota. Require JSON content type and disable screenshot caching.
- Add a local sign-in demo with expiring HttpOnly sessions and server-side logout/revocation; include session integration
  and migration guidance for existing websites. The CLI supports `--auth-module` and rejects public-token configurations.
- Explain denied access in English, Spanish, and Portuguese, keep descriptions for retry, and suppress ZIP fallback on 401/403.
- Preserve report-button and menu-action DOM nodes during background report refreshes so taps are not lost on mobile.
- Add regression coverage for unauthenticated/unauthorized access, forged identities, revocation, ownership isolation,
  account/IP limits, strict content types, and real browser sign-in/logout.

## [0.1.1] - 2026-10-17

### Fixed
- Select explicit server and CLI test files so the test command works on Node.js 18, 20, and 22.

## [0.1.0] - 2026-10-17

First public release.

### Added
- Public community repository, MIT licensing, illustrated usage guide, contribution and issue links, and downloadable
  browser bundle and package through GitHub Releases.
- Widget: Shadow DOM floating button, drag/touch/keyboard region selection or whole screen, description and type chips,
  region and full screenshots (html-to-image), viewport, URL (secrets redacted), element path under the box, optional
  console errors, custom metadata hook, input/password/`data-bug-mask` masking, "My reports" with status and fix note,
  English/Spanish/Portuguese strings, backend-less download mode (.zip), script-tag and npm use.
- Server: fetch-style handler plus Node/Express and route-handler adapters; token auth, CORS allowlist, body and image
  limits, PNG verification, rate limit, per-reporter lists, webhook with HMAC signature, storage adapter interface, filesystem
  and in-memory storage.
- CLI: `list`, `show`, `export` (grouped `WORKLIST.md`), `close`, `reopen`, `import`, `serve`.
- `prompts/FIX_BUGS.md` and a short variant for AI coding agents.
- Examples for plain HTML, React, Vue/Svelte, Next.js, Express, static sites.
