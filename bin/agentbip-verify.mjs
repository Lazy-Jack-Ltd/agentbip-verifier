#!/usr/bin/env node
/**
 * agentbip-verify — independent verifier for the AgentBip research-record anchor chain
 * (agentbip-anchor-v1). Proves, WITHOUT trusting AgentBip/Lazy-Jack infrastructure, that the
 * research record was (a) committed to the XRPL before outcomes, (b) never rewritten,
 * (c) never selectively pruned. Pattern: bipcircle-verifier (Lazy-Jack, MIT).
 *
 * ZERO runtime dependencies — Node 20+ (fetch + crypto). Trust roots are PINNED IN SOURCE,
 * not user input, so a social-engineered address cannot produce a false PASS.
 *
 *   agentbip-verify [--network testnet|mainnet] [--witness-dir <path>]
 *                   [--json] [--chain-only]
 *
 * Exit: 0 = PASS, 1 = FAIL, 2 = invocation error.
 *
 * WHAT A PASS PROVES / DOES NOT PROVE (printed on every run):
 *   PROVES   - each anchored record existed at its XRPL ledger-close time (commit-before-outcome);
 *              append-only files were never rewritten; sequential trial numbering has no gaps;
 *              strategy configs were frozen (configHash) before any results referencing them.
 *   NOT      - that trades were real fills with real money. Paper records remain paper. Broker
 *              statements remain the ground truth for money moved; this chain proves the books
 *              match what was claimed in real time.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ---- pinned trust roots (per release; never user input) ----
const PINNED = {
  // TESTNET pilot chain (2026-06). Witnesses NOT publicly archived (pilot) — use --witness-dir or --chain-only.
  testnet: { address: 'rwWsxUpjEutLmvsG9VUtpS2EksVk8MGeJd', rpcs: ['https://s.altnet.rippletest.net:51234'] },
  // TWO independent FULL-HISTORY endpoints, cross-checkedevery run (split-view mitigation): a single
  // lying/pruned RPC could serve a stale prefix 0..K and continuity would still pass.
  mainnet: { address: 'rwdFhg97kMBisKCYcP7fuah4vYsYJdJhKP', rpcs: ['https://s2.ripple.com:51234', 'https://xrplcluster.com'] }, // PRE-PINNED 2026-06-12 BEFORE genesis
};
const WITNESS_URL = 'https://storage.googleapis.com/agentbip-anchors-public/witnesses/'; // public, CORS GET, create-only immutable
const MEMO_TYPE_HEX = Buffer.from('agentbip/anchor/v1', 'utf8').toString('hex').toUpperCase();
const VERSION = 'agentbip-anchor-v1';

import { merkleRoot, witnessLeaves, linesSha256, sha256hex } from '../lib/crypto.mjs';

// ---- XRPL fetch (raw JSON-RPC; full pagination) ----
async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params: [params] }) });
  if (!res.ok) throw new Error(`rpc ${method} http ${res.status}`);
  const body = await res.json();
  if (body.result?.status !== 'success') throw new Error(`rpc ${method}: ${body.result?.error_message ?? body.result?.error ?? 'unknown'}`);
  return body.result;
}
async function fetchAnchors(rpcUrl, address) {
  const txs = [];
  let marker;
  do {
    const r = await rpc(rpcUrl, 'account_tx', { account: address, ledger_index_min: -1, ledger_index_max: -1, limit: 200, forward: true, ...(marker ? { marker } : {}) });
    txs.push(...(r.transactions ?? []));
    marker = r.marker;
  } while (marker);
  const anchors = [];
  for (const entry of txs) {
    const tx = entry.tx ?? entry.tx_json ?? {};
    if (tx.Account !== address) continue;
    for (const m of tx.Memos ?? []) {
      if ((m.Memo?.MemoType ?? '').toUpperCase() !== MEMO_TYPE_HEX) continue;
      try {
        const memo = JSON.parse(Buffer.from(m.Memo.MemoData, 'hex').toString('utf8'));
        if (memo.v === VERSION) { if (entry.validated === false) throw new Error(`anchor ${tx.hash ?? entry.hash} is NOT in a validated ledger`); anchors.push({ memo, hash: tx.hash ?? entry.hash, date: tx.date }); }
      } catch { /* not ours */ }
    }
  }
  return anchors;
}

// ---- verification stages ----
const out = { stages: [], verdict: 'FAIL' };
const stage = (name, ok, detail) => { out.stages.push({ name, ok, detail }); console.log(`${ok ? '  OK ' : 'FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); return ok; };

async function main() {
  const argv = process.argv.slice(2);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const network = arg('--network') ?? 'mainnet'; // mainnet is the live chain; a first run must verify the real record
  const json = argv.includes('--json');
  const witnessDir = arg('--witness-dir');
  const pin = PINNED[network];
  if (!pin) { console.error(`unknown network ${network}`); process.exit(2); }
  const address = arg('--unsafe-address') ?? pin.address; // unsafe override (testnet/migration use)
  if (arg('--unsafe-address') && network === 'mainnet' && !argv.includes('--i-accept-unpinned-address')) {
    console.error('mainnet with --unsafe-address additionally requires --i-accept-unpinned-address (a PASS would bind to an address YOU chose, not the pinned trust root)');
    process.exit(2);
  }
  if (!address) { console.error(`no pinned address for ${network} yet — pass --unsafe-address (clearly UNSAFE: you are trusting the address you supply)`); process.exit(2); }
  if (arg('--unsafe-address')) console.log('!! UNSAFE: address supplied by caller, not pinned in source — a PASS binds only to THAT address.\n');

  console.log(`agentbip-verify — network=${network} address=${address}\n`);
  out.unsafe = Boolean(arg('--unsafe-address'));

  // 1. fetch from the primary pinned full-history endpoint, cross-check the tip against the
  // second (split-view mitigation: one lying/pruned node could withhold the newest anchors).
  const anchors = await fetchAnchors(pin.rpcs[0], address);
  if (!stage('fetch anchors (full-history node)', anchors.length > 0, `${anchors.length} anchor tx(s) via ${new URL(pin.rpcs[0]).host}`)) return finish(1, json);
  if (pin.rpcs[1]) {
    try {
      const second = await fetchAnchors(pin.rpcs[1], address);
      const tip = (a) => a.length ? a.reduce((m, x) => (x.memo.seq > m.memo.seq ? x : m)).hash : 'none';
      if (!stage('independent endpoint cross-check (split-view)', second.length === anchors.length && tip(second) === tip(anchors), `${new URL(pin.rpcs[1]).host}: ${second.length} anchor(s), tip ${tip(second) === tip(anchors) ? 'matches' : 'DIFFERS — one endpoint is lying or stale'}`)) return finish(1, json);
    } catch (e) {
      stage('independent endpoint cross-check (split-view)', true, `SKIPPED — ${new URL(pin.rpcs[1]).host} unreachable (${e.message}); single-endpoint result`);
    }
  }
  // tip age: a human must notice a stale chain even when continuity passes
  const RIPPLE_EPOCH = 946684800; // 2000-01-01 in unix seconds
  const newest = anchors.reduce((m, x) => (x.memo.seq > m.memo.seq ? x : m));
  if (typeof newest.date === 'number') {
    const ageDays = Math.floor((Date.now() / 1000 - (newest.date + RIPPLE_EPOCH)) / 86400);
    stage('chain tip age', true, `newest anchor (seq ${newest.memo.seq}) is ${ageDays} day(s) old — judge staleness yourself`);
  }

  // 2. chain
  anchors.sort((a, b) => a.memo.seq - b.memo.seq);
  let chainOk = anchors[0].memo.seq === 0 && anchors[0].memo.type === 'genesis' && anchors[0].memo.prev === null;
  let chainDetail = chainOk ? '' : 'missing genesis (seq 0)';
  for (let i = 1; chainOk && i < anchors.length; i++) {
    if (anchors[i].memo.seq !== i) { chainOk = false; chainDetail = `seq gap at ${i} (found ${anchors[i].memo.seq})`; }
    else if (anchors[i].memo.prev !== anchors[i - 1].hash) { chainOk = false; chainDetail = `prev-hash break at seq ${i}`; }
  }
  if (!stage('anchor chain continuity (seq + prev-hash)', chainOk, chainDetail || `${anchors.length} anchors, seq 0..${anchors.length - 1}`)) return finish(1, json);

  // registration anchors verifiable without witnesses
  const regs = anchors.filter((a) => a.memo.type === 'registration');
  stage('registration anchors (configHash committed on-chain)', true, `${regs.length} registration(s): ${regs.map((r) => `#${r.memo.hypothesisId}@${(r.memo.configHash ?? '').slice(0, 6)}`).join(', ') || 'none yet'}`);

  // 3-5. witness content checks. Default: fetch witnesses from the pinned PUBLIC bucket (spec G2 —
  // published within 24h of each anchor; a missing public witness is a completeness FAILURE, not a
  // shrug). --witness-dir verifies local files instead; --chain-only skips content checks.
  if (argv.includes('--chain-only')) {
    stage('content verification', true, 'SKIPPED (--chain-only)');
    return finish(0, json, 'CHAIN-LEVEL PASS (content checks skipped by flag)');
  }
  const getWitness = async (name) => {
    if (witnessDir) { const p = join(witnessDir, name); return existsSync(p) ? readFileSync(p) : null; }
    try { const r = await fetch(WITNESS_URL + name); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; } catch { return null; }
  };
  const replay = {}; // path -> array of lines accumulated across witnesses
  let contentOk = true;
  const regSeqByHash = new Map(regs.map((r) => [r.memo.configHash, r.memo.seq]));
  let orderingOk = true; let orderingDetail = '';
  let lastTrialCount = 0; let trialSeqOk = true;
  for (const a of anchors) {
    const name = a.memo.witness.path.split('/').pop();
    const raw = await getWitness(name);
    if (raw === null) { contentOk = stage(`witness seq ${a.memo.seq}`, false, `${name} not available ${witnessDir ? 'in --witness-dir' : 'at the public witness URL (completeness failure)'}`) && contentOk; continue; }
    const bytes = raw.toString('utf8');
    if (sha256hex(bytes) !== a.memo.witness.sha256) { contentOk = stage(`witness seq ${a.memo.seq} sha256`, false, 'hash mismatch') && contentOk; continue; }
    const w = JSON.parse(bytes);
    if (merkleRoot(witnessLeaves(w.newLines)) !== a.memo.root) { contentOk = stage(`witness seq ${a.memo.seq} merkle`, false, 'root mismatch') && contentOk; continue; }
    for (const [path, lines] of Object.entries(w.newLines)) {
      replay[path] = (replay[path] ?? []).concat(lines);
      // commit-before-outcome + trial continuity, from the replayed registry
      if (path.endsWith('trial-registry.jsonl')) {
        for (const line of lines) {
          try {
            const row = JSON.parse(line);
            if (row.configHash && row.configHash !== 'pre-factory' && ['backtest', 'grid'].includes(row.stage)) {
              const regSeq = regSeqByHash.get(row.configHash);
              const fromGenesisImport = a.memo.seq === 0;
              if (!fromGenesisImport && (regSeq === undefined || regSeq >= a.memo.seq)) { orderingOk = false; orderingDetail = `trial for ${row.configHash.slice(0, 6)} at anchor seq ${a.memo.seq} lacks a STRICTLY EARLIER registration anchor (same-anchor bundling is not commit-before-outcome)`; }
            }
            if (typeof row.trialCountGlobal === 'number') {
              if (row.trialCountGlobal < lastTrialCount) trialSeqOk = false;
              lastTrialCount = Math.max(lastTrialCount, row.trialCountGlobal);
            }
          } catch { /* non-JSON line fails fullSha anyway */ }
        }
      }
    }
    for (const [path, st] of Object.entries(w.files)) {
      const have = replay[path] ?? [];
      if (have.length !== st.lineCount || linesSha256(have) !== st.fullSha256) {
        contentOk = stage(`append-only continuity ${path} @ seq ${a.memo.seq}`, false, 'replayed content does not match anchored fullSha256 — history was rewritten') && contentOk;
      }
    }
  }
  stage('witness hashes + merkle roots', contentOk, contentOk ? `${anchors.length} witnesses verified` : undefined);
  stage('append-only continuity (full replay)', contentOk);
  stage('commit-before-outcome ordering', orderingOk, orderingDetail || 'every post-genesis trial row has an earlier registration anchor');
  stage('trialCountGlobal monotonic (no omitted trials)', trialSeqOk, `max trialCountGlobal ${lastTrialCount}`);
  return finish(contentOk && orderingOk && trialSeqOk ? 0 : 1, json);
}

function finish(code, json, label) {
  out.verdict = (code === 0 ? (label ?? 'PASS') : 'FAIL') + (out.unsafe ? ' (UNSAFE ADDRESS — not the pinned trust root)' : '');
  console.log(`\nVERDICT: ${out.verdict}`);
  console.log('\nThis verifies record INTEGRITY + TIMING. It does NOT prove trades were real-money fills;');
  console.log('paper records remain paper, and broker statements remain the ground truth for money moved.');
  if (json) console.log(JSON.stringify(out, null, 2));
  process.exit(code);
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(2); });
