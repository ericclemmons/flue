import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { WithCloudflareBinding } from './agents/with-cloudflare-binding';

const app = new Hono();

app.get('/api/ping', (c) => c.json({ pong: true, at: new Date().toISOString() }));
app.route('/agents/with-cloudflare-binding', createAgentRouter(WithCloudflareBinding));

export default app;
