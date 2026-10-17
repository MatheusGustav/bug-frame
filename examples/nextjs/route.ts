// app/api/bugframe/[...path]/route.ts  (Next.js App Router; the same shape works in SvelteKit, Remix, Hono, Astro, Cloudflare Workers with a custom storage adapter)
import { createBugframe, routeHandlers } from 'bugframe/server';

const bf = createBugframe({
  dir: process.env.BUGFRAME_DIR ?? './bug-reports',      // on serverless hosts use a storage adapter instead (see examples/storage-adapters)
  basePath: '/api/bugframe',
  clientTokens: [process.env.NEXT_PUBLIC_BUGFRAME_TOKEN!],
  adminToken: process.env.BUGFRAME_ADMIN_TOKEN,
  trustProxy: true,                                       // you are behind your host's proxy; rate limits use X-Forwarded-For
});

export const { GET, POST, PATCH, OPTIONS } = routeHandlers(bf);
export const runtime = 'nodejs';
