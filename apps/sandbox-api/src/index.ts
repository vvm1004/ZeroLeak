import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const app = createApp();

const port = Number(process.env.PORT) || 8080;
console.log(`[Sandbox API] Server starting on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
});

export default app;

