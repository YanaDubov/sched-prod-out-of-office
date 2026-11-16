import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function command(file, args, { cwd, env = {}, timeout = 120000, maxOutput = 100000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = data => { if (output.length < maxOutput) output += data.toString().slice(0, maxOutput - output.length); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, code, output }); });
  });
}

export async function runSandbox(root, { keys, allowShapeChange, image = 'node:22-alpine', fixtureCheck = false } = {}) {
  if (!/^(node:22-alpine|(?:docker\.io\/library\/)?node@sha256:[a-f0-9]{64})$/.test(image)) throw new Error('The sandbox requires the approved official Node image or its immutable digest.');
  const temporary = await mkdtemp(join(tmpdir(), 's03e03-test-'));
  const tag = 's03e03-test-' + randomUUID();
  let built = false;
  try {
    for (const directory of ['src', 'agent', 'tests']) await mkdir(join(temporary, directory));
    for (const path of ['src/index.js', 'package.json', 'agent/contract-guard.test.mjs']) {
      await copyFile(join(root, path), join(temporary, path));
    }
    if (fixtureCheck) await copyFile(join(root, 'agent/preflight-fixture.test.mjs'), join(temporary, 'agent/preflight-fixture.test.mjs'));
    for (const name of await readdir(join(root, 'tests')).catch(() => [])) {
      if (/^issue-[a-zA-Z0-9-]+\.test\.mjs$/.test(name)) await copyFile(join(root, 'tests', name), join(temporary, 'tests', name));
    }
    // Send a build context through Docker's API rather than assuming the runner's
    // /tmp is also mounted in the Docker daemon's filesystem namespace.
    await writeFile(join(temporary, 'Dockerfile'), `FROM ${image}\nWORKDIR /workspace\nCOPY --chown=root:root . /workspace/\nUSER node\n`);
    const build = await command('docker', ['build', '--network=none', '--pull=false', '--tag', tag, temporary], { timeout: 90000 });
    if (!build.ok) return { ...build, output: 'Sandbox image packaging failed:\n' + build.output };
    built = true;
    const args = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
      '--workdir', '/workspace',
      '--env', `APPROVED_RESPONSE_KEYS=${JSON.stringify(keys)}`,
      '--env', `OWNER_APPROVED_SHAPE_CHANGE=${Boolean(allowShapeChange)}`,
      tag, 'sh', '-c', `node --test agent/contract-guard.test.mjs${fixtureCheck ? ' agent/preflight-fixture.test.mjs' : ''} && if ls tests/issue-*.test.mjs >/dev/null 2>&1; then node --test tests/issue-*.test.mjs; fi`];
    return await command('docker', args, { timeout: 90000 });
  } finally {
    if (built) await command('docker', ['image', 'rm', '--force', tag], { timeout: 30000 }).catch(() => {});
    // Only this call's newly created, exact test directory is removed.
    await rm(temporary, { recursive: true, force: true });
  }
}
