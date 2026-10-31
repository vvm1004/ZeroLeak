import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import dotenv from 'dotenv';

dotenv.config();

const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'zeroleak-sandbox-api',
    timestamp: new Date().toISOString(),
  });
});

const port = Number(process.env.PORT) || 8080;
console.log(`[Sandbox API] Server starting on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
