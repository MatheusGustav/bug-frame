// Express: mount the API under a prefix. basePath must match the mount prefix.
import express from 'express';
import { createBugframe, expressMiddleware } from 'bugframe/server';
import { authorize } from '../auth-module.mjs';

const app = express();
const bf = createBugframe({
  dir: './bug-reports', basePath: '/api/bugframe',
  authorize, // verifies the site's login session AND permission; no configured module = browser access denied
  adminToken: process.env.BUGFRAME_ADMIN_TOKEN,
  allowedOrigins: ['https://www.example.com'],   // only needed if the page is on another origin than this API
  trustProxy: true,
});
app.use('/api/bugframe', expressMiddleware(bf, { trustProxy: true })); // before express.json(): it reads its own body (or uses an already parsed one)
app.use(express.json());
app.listen(3000);
