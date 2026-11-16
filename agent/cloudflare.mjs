export const WORKERS = new Set(['yana-s03e03-api', 'yana-s03e03-model']);

export async function cloudflare(account, token, path, { method = 'GET', body, headers = {}, audit = () => {} } = {}) {
  if (!/^[a-f0-9]{32}$/.test(account) || !token) throw new Error('Scoped Cloudflare access is not configured.');
  if (!/^\/workers\/(scripts(?:\/yana-s03e03-(?:api|model)(?:\/subdomain)?)?|subdomain)$/.test(path)) {
    throw new Error('Cloudflare control is restricted to the two approved Workers.');
  }
  if (!['GET', 'PUT', 'POST'].includes(method)
      || (method === 'PUT' && !/^\/workers\/scripts\/yana-s03e03-(api|model)$/.test(path))
      || (method === 'POST' && !/^\/workers\/scripts\/yana-s03e03-(api|model)\/subdomain$/.test(path))) {
    throw new Error('That Cloudflare operation is not part of the approved setup/deploy scope.');
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method, body, headers: { ...headers, Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  audit({ kind: 'cloudflare', method, path, status: response.status, success: data.success,
    errors: (data.errors ?? []).map(item => ({ code: item.code, message: item.message })) });
  if (!response.ok || !data.success) throw new Error(`Cloudflare ${method} ${path}: HTTP ${response.status}; ${(data.errors ?? []).map(x => x.code).join(',')}`);
  return data.result;
}

export async function uploadWorker({ account, token, name, modules, bindings, audit }) {
  if (!WORKERS.has(name) || !modules['main.mjs']) throw new Error('Refusing an unapproved deployment target.');
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    main_module: 'main.mjs', compatibility_date: '2026-10-01', bindings,
    observability: { enabled: false },
  })], { type: 'application/json' }));
  for (const [path, text] of Object.entries(modules)) {
    form.append(path, new File([text], path, { type: 'application/javascript+module' }));
  }
  return cloudflare(account, token, `/workers/scripts/${name}`, { method: 'PUT', body: form, audit });
}
