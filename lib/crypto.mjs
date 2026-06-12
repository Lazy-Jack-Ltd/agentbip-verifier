// ---- spec-normative crypto (agentbip-anchor-v1; vectors in test/) ----
import { createHash } from 'node:crypto';
export const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
export function merkleRoot(leaves) {
  if (leaves.length === 0) return sha256hex('');
  let level = leaves.map((l) => createHash('sha256').update(Buffer.concat([Buffer.from([0]), Buffer.from(l, 'utf8')])).digest());
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < level.length; i += 2) next.push(createHash('sha256').update(Buffer.concat([Buffer.from([1]), level[i], level[i + 1]])).digest());
    if (level.length % 2 === 1) next.push(level[level.length - 1]); // odd node PROMOTED, never duplicated
    level = next;
  }
  return level[0].toString('hex');
}
export const witnessLeaves = (newLines) => Object.keys(newLines).sort().flatMap((p) => newLines[p]);
export const linesSha256 = (lines) => sha256hex(lines.map((l) => l + '\n').join(''));
