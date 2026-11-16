# sched-prod-api

The incidents API of `sched-prod`, a scheduling product. A Cloudflare Worker (`src/index.js`) that serves
production's incidents to the status page, the on-call board and the support console.

- `contract/api.md` — the pinned API contract.
- `decisions/TEMPLATE.md` — the shape of a decision record. The records themselves are on the tracker.
- `research/` — research the product team has collected.
- `AGENTS.md` — how work lands here and the tracker's calls. Read it before the first change.

## Run it

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and set `FEED_URL` to the feed URL the round hands you.
3. `npm run dev`

## Live

`npm run deploy` ships production to your own Cloudflare account (Workers Free is enough), at a public
**https** address.

## An agent that works while you are away

Issues arrive on the tracker while you are not watching. Something has to wake on each one, work it and
ship it. Pick a runner; any of these can do it:

- **A scheduled Worker or job** — a cron trigger every minute that reads the tracker and hands new work
  to a coding agent.
- **A cloud agent** — e.g. Claude Code on the web, Cursor background agents, Codex cloud, on a schedule.
- **Your own box** — a VPS or a spare machine with a loop and a headless CLI (`claude -p`,
   `codex exec`, `gemini`).

## This Challenge's hosted runner

This repository uses a manually dispatched, bounded GitHub Actions job on a standard free Ubuntu runner. It polls the course tracker every 30 seconds, acknowledges new issues independently of model calls, and gives each issue to a real tool-using model. Nothing starts automatically on pushes or pull requests.

- `agent/run.mjs` loads the actual `.agents/skills/triage/SKILL.md`, project rules, research, source, and every current decision record with its history.
- `agent/runtime.mjs` exposes narrow read/write/test/deploy/tracker tools. The model can edit only application source and issue tests, not the workflow, policy, secrets or control code.
- `agent/sandbox.mjs` runs generated tests in a credential-free, network-disabled, read-only Docker sandbox. It does not run model-written shell commands on the host.
- `agent/model-worker.mjs` is a separately authenticated Cloudflare helper for the fixed free-capable GLM-4.7-Flash model. Its authorization expires, and there is no paid/provider fallback.
- `worker.mjs` is the fixed deployment wrapper. Application code receives only the production feed URL, never Cloudflare/GitHub credentials, AI access or a production-write token.

The only deployment targets are `yana-s03e03-api` and `yana-s03e03-model`; other account projects are out of scope. The initial API deliberately reports its feed as unconfigured until the course opens a round and supplies the actual URL. No incident fixtures are presented as production.

### Human decisions

Only an actual owner `/answer N` entry from the course round page selects a proposed option. The agent then accepts that version, builds only the chosen scope and asks the owner to sign. A record is not complete for the final claim until the tracker says its current version is signed. The runner cannot sign or impersonate the owner.

### Credentials and evidence

GitHub Actions secrets carry the isolated round's tracker token, read-only feed URL, helper authentication and deployment access. No secrets or round receipts belong in commits or plaintext logs. Detailed redacted evidence is encrypted with an owner-held key before it is emitted in the workflow log; public readers cannot decrypt it. No artifact/cache storage or paid runner is used.

The job has a 70-minute platform timeout, and its own loop stops within 60 minutes. It reports `ROUND_READY` only after the last issue has arrived, all issues have honest final outcomes, all required current records are signed, and the API is live. That is readiness for the coordinator's official course claim, not a substitute for course acceptance.

### Control tests without dependency installation

```
node --test agent/policy.test.mjs agent/runtime.test.mjs
```

The hosted `preflight` workflow separately checks isolated API compatibility tests, actual native model function calling, the initial public deployment and authentication. It also asks the model to write and test a harmless fixture endpoint in a throwaway workspace, independently verifies the result, and discards that code without deploying or committing it. Open the timed round only after that preflight passes and the owner is ready on the round page.
