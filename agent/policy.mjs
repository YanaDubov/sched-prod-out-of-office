import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const BASE_KEYS = ['id', 'service', 'summary', 'status', 'openedAt'];

export function safeMutablePath(path) {
  return path === 'src/index.js' || /^tests\/issue-[a-zA-Z0-9-]+\.test\.mjs$/.test(path);
}

export function ownerAnswer(issue, proposedAt, optionCount) {
  const answers = (issue.thread ?? []).filter(entry => entry.by === 'owner' && entry.kind === 'comment'
    && Date.parse(entry.at) >= Date.parse(proposedAt))
    .map(entry => ({ entry, match: String(entry.body).match(/(?:^|\n)\s*\/answer\s+(\d+)\b/) }))
    .filter(({ match }) => match && Number(match[1]) >= 1 && Number(match[1]) <= optionCount);
  const found = answers.at(-1);
  return found ? { choice: Number(found.match[1]), at: found.entry.at, by: 'owner' } : null;
}

export function currentVersionSigned(record) {
  return record?.status === 'accepted' && Boolean(record.signedBy) && Boolean(record.signedAt)
    && Array.isArray(record.versions) && record.versions.length > 0 && record.versions.at(-1).signed === true;
}

export function recordText({ id, issue, title, ask, options, recommendation, cost, reversibility, metric, reopen, decision }) {
  if (!/^\d{4}-[a-z0-9-]+$/.test(id) || Number(id.slice(0, 4)) < 7) throw new Error('A new decision id must start at 0007.');
  if (!Number.isInteger(issue) || issue < 1 || !Array.isArray(options) || options.length < 2) throw new Error('A decision needs an issue and alternatives.');
  if (!options.every(x => ['decline', 'smaller', 'full'].includes(x.kind) && x.text?.trim())) throw new Error('Tag every option decline/smaller/full.');
  if (!options.some(x => x.kind === 'decline')) throw new Error('Include a real decline option.');
  if (!Number.isInteger(recommendation) || recommendation < 1 || recommendation > options.length) throw new Error('Recommend a numbered option.');
  for (const [key, value] of Object.entries({ title, ask, cost, reversibility, metric, reopen })) {
    if (typeof value !== 'string' || value.trim().length < 12) throw new Error(`Decision ${key} needs concrete evidence, not an empty heading.`);
  }
  for (const value of [title, ask, cost, reversibility, metric, reopen, ...options.flatMap(x => [x.text, x.why ?? ''])]) {
    if (/^---\s*$|^##\s+(Ask|Options|Cost of being wrong|Reversibility|Success metric|Reopen threshold|Decision)\s*$/m.test(value)) {
      throw new Error('Decision fields must not inject duplicate record sections or frontmatter.');
    }
  }
  return `---\nid: ${id.slice(0, 4)}\ntitle: ${JSON.stringify(title)}\nissue: ${issue}\nstatus: ${decision ? 'accepted' : 'proposed'}\nsigned-by:\n---\n\n## Ask\n${ask}\n\n## Options\n${options.map((x, i) => `${i + 1}. ${x.text} — kind: ${x.kind}`).join('\n')}\n\nRecommendation: ${recommendation}, because ${options[recommendation - 1].why ?? ask}\n\n## Cost of being wrong\n${cost}\n\n## Reversibility\n${reversibility}\n\n## Success metric\n${metric}\n\n## Reopen threshold\n${reopen}\n\n## Decision\n${decision ?? 'Awaiting the owner’s answer on the round page.'}\n`;
}

export function shipLine(issue, verb, risks = []) {
  if (!Number.isInteger(issue) || !['shipped', 'declined', 'closed', 'asked', 'waiting'].includes(verb)) throw new Error('Invalid ship outcome.');
  for (const risk of risks) {
    if (!Number.isInteger(risk.issue) || !risk.reader?.trim()) throw new Error('Each open risk needs an issue and reader.');
    if (/[\n\r·|]/.test(risk.reader)) throw new Error('Risk readers must fit one ship line.');
  }
  return `#${issue} · ${verb} · live: ${verb === 'shipped' ? '✓' : '✗'} · open risks: ${risks.length ? risks.map(x => `#${x.issue} ${x.reader}`).join('; ') : 'none'}`;
}

export function jsonContains(actual, expected) {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && (expected.length === 0 ? actual.length === 0 : expected.every((x, i) => jsonContains(actual[i], x)));
  return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => jsonContains(actual[key], value));
}
