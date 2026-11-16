// A single-model, authenticated Workers Free helper. It cannot deploy or access the tracker.
const MODEL = '@cf/zai-org/glm-4.7-flash';

function authorized(request, token) {
  const actual = request.headers.get('Authorization') ?? '';
  const expected = `Bearer ${token ?? ''}`;
  let different = actual.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) different |= (actual.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return Boolean(token) && different === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/complete' || request.method !== 'POST' || !authorized(request, env.MODEL_TOKEN)) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    if (!Number.isFinite(Number(env.EXPIRES_AT)) || Date.now() >= Number(env.EXPIRES_AT)) {
      return Response.json({ error: 'helper authorization expired' }, { status: 410 });
    }
    try {
      const reader = request.body?.getReader();
      if (!reader) return Response.json({ error: 'JSON required' }, { status: 400 });
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 262144) {
          await reader.cancel();
          return Response.json({ error: 'prompt exceeds limit' }, { status: 413 });
        }
        chunks.push(value);
      }
      const raw = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
      const input = JSON.parse(new TextDecoder().decode(raw));
      if (!Array.isArray(input.messages) || input.messages.length > 80 || !Array.isArray(input.tools) || input.tools.length > 16) {
        return Response.json({ error: 'invalid conversation' }, { status: 400 });
      }
      const response = await env.AI.run(MODEL, {
        messages: input.messages,
        tools: input.tools,
        tool_choice: input.tool_choice ?? 'auto',
        max_completion_tokens: Math.min(6000, Math.max(128, Number(input.max_completion_tokens) || 6000)),
        temperature: 0.2,
        parallel_tool_calls: false,
        chat_template_kwargs: { enable_thinking: false },
        store: false,
        stream: false,
      });
      return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      // Only the authenticated runner sees this bounded diagnostic, never public traffic.
      return Response.json({ error: 'model request failed', reason: String(error?.message ?? 'unknown').slice(0, 400) }, {
        status: 503, headers: { 'Cache-Control': 'no-store' },
      });
    }
  },
};
