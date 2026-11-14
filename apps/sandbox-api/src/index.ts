import './env.js';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT) || 8080;
const hostname = '0.0.0.0';

console.log(`[Sandbox API] Initializing server on ${hostname}:${port}...`);

const server = serve({
  fetch: app.fetch,
  port,
  hostname,
}, (info) => {
  console.log(`[Sandbox API] Successfully listening on http://${info.address}:${info.port}`);
});

server.on('error', (err) => {
  console.error('[Sandbox API] Server error:', err);
});

export default app;


