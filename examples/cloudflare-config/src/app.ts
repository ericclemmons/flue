import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Echo } from './agents/echo.ts';

const app = new Hono<{ Bindings: { MESSAGE: string } }>();
app.get('/', (context) => context.text(context.env.MESSAGE));
app.route('/agents/echo', createAgentRouter(Echo));

export default app;
