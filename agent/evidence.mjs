import { createCipheriv, randomBytes, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export function evidenceLogger(secrets = []) {
  const events = [];
  const clean = value => {
    let text = JSON.stringify(value);
    for (const secret of secrets.filter(x => typeof x === 'string' && x.length > 4)) text = text.split(secret).join('[REDACTED]');
    return JSON.parse(text);
  };
  return {
    events,
    add(event) { events.push(clean({ at: new Date().toISOString(), ...event })); },
    emit(key) {
      if (!key || !/^[a-f0-9]{64}$/.test(key)) return;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
      const compressed = gzipSync(Buffer.from(JSON.stringify(events)));
      const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
      const envelope = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
      console.log(`S03E03_EVIDENCE_SHA256 ${createHash('sha256').update(envelope).digest('hex')}`);
      for (let offset = 0, index = 0; offset < envelope.length; offset += 12000, index++) {
        console.log(`S03E03_EVIDENCE_CHUNK ${index} ${envelope.slice(offset, offset + 12000)}`);
      }
    },
  };
}
