# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project
uses [Semantic Versioning](https://semver.org/).

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
