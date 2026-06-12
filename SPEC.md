# agentbip-anchor-v1 — wire format (normative)

One XRPL `AccountSet` tx per anchor. `MemoType` = hex("agentbip/anchor/v1"), `MemoData` =
hex(canonical JSON: sorted keys, no whitespace):

```json
{"v":"agentbip-anchor-v1","type":"genesis|registration|daily","seq":0,"prev":null,
 "date":"YYYY-MM-DD","root":"<merkle root hex>","witness":{"sha256":"<hex>","path":"data/<file>"}}
```

- `seq` strictly monotonic from 0 (genesis, `prev:null`); `prev` = tx hash of seq-1 (hash chain).
- `registration` anchors add top-level `hypothesisId` + `configHash` (verifiable without witnesses).

## Witness file (public archive: https://storage.googleapis.com/agentbip-anchors-public/witnesses/)

```json
{"v":"agentbip-anchor-v1","seq":N,"date":"...",
 "files":{"<path>":{"fullSha256":"<hex>","lineCount":N}},
 "newLines":{"<path>":["<verbatim JSONL line>", "..."]}}
```

- Canonical JSON bytes; `witness.sha256` in the memo binds them exactly.
- `fullSha256` = sha256 of the first `lineCount` lines of the file, EACH terminated `\n`.
- Replaying genesis `newLines` + every subsequent `newLines` must reproduce every anchored
  `fullSha256` (append-only continuity); any rewrite of history fails verification.

## Merkle (lib/crypto.mjs; vectors in test/)

- Leaves: each newLine string, file-path-sorted then in-file order.
- leafHash = sha256(0x00 || utf8(line)); nodeHash = sha256(0x01 || L || R) — domain-separated.
- Odd node is PROMOTED (never duplicated). Empty set ⇒ root = sha256("").

## Trust roots

Pinned per release in `bin/agentbip-verify.mjs`: anchor address, FULL-HISTORY RPC endpoint
(pruned nodes can hide old anchors — sequence gaps are a HARD FAIL), public witness URL.
Mainnet anchor: `rwdFhg97kMBisKCYcP7fuah4vYsYJdJhKP` (genesis `4B077F8B…`, 2026-06-12,
announced before genesis; cross-announced by bipcircle-verifier).
