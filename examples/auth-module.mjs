// Shared by the framework examples. The website supplies its real server-side session verifier.
// Set BUGFRAME_AUTH_MODULE=/absolute/path/to/your/bugframe-auth.mjs (see authentication/README.md).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const path = process.env.BUGFRAME_AUTH_MODULE;
const module = path ? await import(pathToFileURL(resolve(path)).href) : null;
if (module && typeof module.authorize !== 'function') throw new Error('BUGFRAME_AUTH_MODULE must export authorize(request)');

// No configured session verifier means no browser users are authorized.
export const authorize = request => module ? module.authorize(request) : null;
