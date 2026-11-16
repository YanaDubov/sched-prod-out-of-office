// Fixed deployment wrapper; only src/index.js is editable by the coding agent.
import api from './src/index.js';

export default {
  async fetch(request, env, ctx) {
    if (!env.FEED_URL && new URL(request.url).pathname === '/incidents') {
      return Response.json({ error: 'production feed is not configured yet' }, { status: 503 });
    }
    try {
      // No deployment credentials, AI access or production-write token enters application code.
      return await api.fetch(request, { FEED_URL: env.FEED_URL }, ctx);
    } catch {
      return Response.json({ error: 'production feed unavailable' }, { status: 502 });
    }
  },
};
