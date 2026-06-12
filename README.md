# agentbip-verify

Independent verifier for the **AgentBip research-record anchor chain** on the XRP Ledger
(`agentbip-anchor-v1`). Proves — without trusting AgentBip or Lazy-Jack infrastructure — that the
research record was **(a)** committed to the ledger before outcomes, **(b)** never rewritten,
**(c)** never selectively pruned. Sister project to
[bipcircle-verifier](https://github.com/Lazy-Jack-Ltd/bipcircle-verifier).

```
npx @lazyjackorg/agentbip-verifier --network testnet --witness-dir ./witnesses
```

Zero runtime dependencies (Node 20+). Trust roots (anchor account address, full-history XRPL
endpoint) are **pinned in source** per release — a social-engineered address cannot produce a
false PASS. Until the mainnet genesis release pins the address, use
`--unsafe-address <r...>` (clearly marked: you are trusting the address you supply).

## What a PASS proves / does not prove

- **PROVES**: each anchored record existed at its XRPL ledger-close time (commit-before-outcome);
  the append-only research files were never rewritten (full-replay continuity); sequential trial
  numbering has no gaps (nothing omitted); strategy configs were frozen (`configHash`) before any
  results referencing them — and when the operator runs with `ANCHOR_REQUIRED=1`, the research
  factory mechanically refuses to run trials for configs without a validated registration anchor.
- **DOES NOT PROVE**: that trades were real fills with real money. Paper records remain paper.
  Broker statements remain the ground truth for money moved; this chain proves the books match
  what was claimed in real time. The CLI prints this caveat on every run.

## Verification stages

1. Fetch all anchor txs from a pinned **full-history** XRPL node (pruned nodes can hide old
   anchors — this is why the endpoint is pinned).
2. Chain continuity: contiguous `seq` from genesis 0, `prev` tx-hash linkage. **Any gap = FAIL.**
3. Registration anchors (configHash) verified directly from memos — no witness access needed.
4. Witness `sha256` vs the anchored hash; Merkle root (domain-separated, odd-promotion) recomputed
   over the revealed lines.
5. Append-only continuity: full replay from genesis must reproduce every anchored `fullSha256`.
6. Commit-before-outcome ordering + monotonic `trialCountGlobal`.

Without witness access the CLI still verifies stages 1–3 and reports a **chain-level PASS**
("content-level unverified") — third parties can track the chain in real time before being
granted the witness exports. Witness files are published within 24h of each anchor per the spec.

Spec: `agentbip-anchor-v1` (see the AgentBip repo, `Documentation/xrpl-anchor-spec-2026-06-12.md`).
Exit codes: `0` PASS · `1` FAIL · `2` invocation error. `--json` for machine-readable output.


## Beyond trading: generalizing the pattern

The discipline this verifier enforces is not specific to trading. It applies to most
computational and empirical research:

| Domain | Fit | Why |
|---|---|---|
| ML / AI experiments | Excellent | configs, datasets, training runs, eval metrics — all digital and hashable |
| Quant finance | Excellent | this repo |
| Scientific computing / simulations | Excellent | reproducible pipelines, clear inputs/outputs |
| Data analysis / statistics | Very good | scripts, datasets, intermediate results |
| Clinical / preclinical analysis | Good | protocols, raw-data hashes, analysis logs (high regulatory value) |
| Pure theory / qualitative / artistic | Low | little empirical record to anchor |
| Wet lab | Medium | protocols + sensor logs + analyses anchor; the physical sample does not |

What transfers: **registration anchors** (freeze methodology before running), **sequential
trial counters** (omissions are detectable), **Merkle + full-replay tamper evidence**, and a
**pinned open-source verifier**. Together these attack selective reporting, post-hoc result
tweaking, and "I ran it yesterday" claims — core mechanics of the reproducibility crisis.

The honest boundary, always: this proves the **integrity and timing of the record** — never
that data was collected honestly or that an experiment was run correctly. It makes certain
fraud much harder; it is not a complete solution to bad science.

The wire format (`SPEC.md`) is deliberately small; adapting it to another domain is mostly a
matter of choosing which append-only files constitute the record. Interested in applying it —
research-anchor for science, clinical trials, AI evals? Contact [Lazy-Jack Ltd](https://github.com/Lazy-Jack-Ltd).
