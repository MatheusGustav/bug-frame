# Security policy

## Reporting a vulnerability

Please do not open a public issue containing a vulnerability. Use
[GitHub's private vulnerability reporting form](https://github.com/vmatheus3/bug-frame/security/advisories/new).
Include what you found, how to reproduce it, and the affected version. Maintainers will review the report and coordinate
a fix privately. Fixes are released as patch versions and credited unless you ask otherwise.

## Supported versions

The latest minor release receives security fixes.

## What the tool does about the obvious risks

- **Screenshots can contain private data.** Inputs, password fields, `[data-bug-mask]` elements and your own `mask`
  selectors are painted over inside the picture before anything leaves the browser; `exclude` removes elements entirely.
  Console capture is off by default. Secrets in query strings are replaced in the recorded URL. Still: turn the tool on only
  for people you trust with what is on screen, and review the first reports.
- **Public endpoint abuse.** The client token is public by design (it is in your page). Real protection is the allowed-origin
  list, the rate limit, the size limits and the PNG check. For an internal tool, put the endpoint behind your own auth with the
  `authorize` hook.
- **Admin actions** (closing reports, listing everyone's reports) require `Authorization: Bearer <adminToken>` and are compared
  in constant time. Never put the admin token in browser code.
- **Stored files:** only ids of the exact form `bug-YYYYMMDD-HHMMSS-xxxx` ever reach the filesystem, only `report.json`,
  `region.png`, `full.png` exist, images are verified as PNG by signature and header and served with
  `nosniff` and a locked-down CSP. Report text is data: render it escaped (the CLI and the widget never execute it).
- **AI agents read reports.** Report text and console output are untrusted input to your coding agent. `prompts/FIX_BUGS.md`
  tells the agent to treat them as data, never as instructions.
