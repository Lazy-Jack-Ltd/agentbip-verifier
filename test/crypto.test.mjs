// Spec-normative vectors for agentbip-anchor-v1 (run: node --test).
// These mirror the writer-side suite in the AgentBip repo — the two implementations
// must agree on every vector or honest data would fail verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { merkleRoot, witnessLeaves, linesSha256, sha256hex } from '../lib/crypto.mjs';

const sha = (b) => createHash('sha256').update(b).digest();
const leaf = (s) => sha(Buffer.concat([Buffer.from([0]), Buffer.from(s, 'utf8')]));
const node = (l, r) => sha(Buffer.concat([Buffer.from([1]), l, r]));

test('empty set: root = sha256("")', () => {
  assert.equal(merkleRoot([]), sha256hex(''));
  assert.equal(merkleRoot([]), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('single leaf: 0x00-domain-separated (NOT the bare hash)', () => {
  assert.equal(merkleRoot(['a']), leaf('a').toString('hex'));
  assert.notEqual(merkleRoot(['a']), sha256hex('a'));
});

test('two leaves: 0x01-prefixed interior node', () => {
  assert.equal(merkleRoot(['a', 'b']), node(leaf('a'), leaf('b')).toString('hex'));
});

test('three leaves: odd node PROMOTED, never duplicated (CVE-2012-2459 class)', () => {
  assert.equal(merkleRoot(['a', 'b', 'c']), node(node(leaf('a'), leaf('b')), leaf('c')).toString('hex'));
  assert.notEqual(merkleRoot(['a', 'b', 'c']), node(node(leaf('a'), leaf('b')), node(leaf('c'), leaf('c'))).toString('hex'));
});

test('leaf/node confusion impossible: interior-node bytes presented as a line do not collide', () => {
  const ab = node(leaf('a'), leaf('b'));
  assert.notEqual(merkleRoot([ab.toString('binary')]), ab.toString('hex'));
});

test('order matters', () => {
  assert.notEqual(merkleRoot(['a', 'b']), merkleRoot(['b', 'a']));
});

test('witnessLeaves: file-path-sorted then in-file order', () => {
  assert.deepEqual(witnessLeaves({ 'b.jsonl': ['3', '4'], 'a.jsonl': ['1', '2'] }), ['1', '2', '3', '4']);
});

test('linesSha256: newline-terminated concatenation', () => {
  assert.equal(linesSha256(['x', 'y']), sha256hex('x\ny\n'));
});
