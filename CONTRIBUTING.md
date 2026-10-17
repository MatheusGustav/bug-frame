# Contributing

Thanks for helping. The project is small on purpose: a widget, a reference server, a CLI and a prompt.

## Setup

```bash
git clone <your fork> && cd bugframe
npm install
npm run test:all        # typecheck, unit + server + CLI tests, build, Playwright end-to-end
```

The first `npm run test:e2e` needs a browser: `npx playwright install chromium`.

## Layout

| Path | What |
| --- | --- |
| `src/widget/` | TypeScript browser widget (Shadow DOM UI, capture, context, i18n, zip) |
| `src/server/` | Dependency-free Node server: fetch handler, adapters, filesystem storage |
| `src/cli/` | The `bugframe` command |
| `types/server.d.ts` | Types for `bugframe/server` (keep in sync by hand) |
| `prompts/` | Prompts for AI agents |
| `examples/` | Copy-paste integrations; `plain-html` is also the e2e test app |
| `test/` | `widget` (Vitest + jsdom), `server` and `cli` (node:test), `e2e` (Playwright) |

## Rules of the road

- Keep the server and CLI free of runtime dependencies. The widget has exactly one (html-to-image).
- Anything the page's CSS could break goes inside the shadow root; anything the tool adds to the page must carry `data-bug-ui`.
- Privacy and safety changes need a test. A bug fix starts with a test that fails.
- New user-facing text goes into every locale in `src/widget/i18n.ts` (a test checks the keys match).
- Update `README.md` and `CHANGELOG.md` with the change.
- Commit messages: short, imperative, one idea per commit.

## Adding a language

Copy the `en` object in `src/widget/i18n.ts`, translate the values, add it to `LOCALES`. That is all.

## Adding a storage adapter

See `examples/storage-adapters/README.md`. Adapters that need extra packages belong in their own package
(`bugframe-storage-s3`), not in core.
