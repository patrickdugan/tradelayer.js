# Tx34 ZK Batch Movement Draft

Date: 2026-05-08

Tx34 now has a draft ZK batch-movement mode. Legacy cross-layer bridge payloads are still decodable, but a payload beginning with `z1|` is treated as a ZK-verified token movement batch.

## Shape

The OP_RETURN stays compact:

```text
z1|envelopeId|movementRoot|proofHash|verifierId|proofType|programHash|publicInputHash|daBlobHash|signedL1TxHash|batchL2TxHash|resultId|envelopeRef
```

The full consensus object is the ZK envelope, normally supplied from witness/DA:

- `signedL1Tx.hex`: signed Bitcoin transaction hex.
- `batchL2Tx.hex`: signed TradeLayer L2 batch transaction hex, including the 2-of-2 channel signature material the prover bound.
- `movements`: token debits and credits in base units.
- `daBlob`: witness or external DA object carrying proof context.
- `verifierResult`: bounded Rust/WASM verifier result committed by `resultId`.

Consensus validation checks the compact OP_RETURN fields against the envelope, verifies the envelope hash structure, calls the packaged Rust/WASM verifier when built, and falls back to the deterministic JS verifier only for source checkouts. Set `TL_ZK_REQUIRE_WASM=1` to force the Rust/WASM path.

## Consensus Effect

After verification, `Logic.zkBatchMove` applies every movement:

1. Debit `movement.from`.
2. Credit `movement.to`.
3. Record an audit row in `zkBatchMovements` keyed by `envelopeId`.

Amounts are carried as integer `amountUnits` and converted to 8-decimal token amounts for the current tally map.

## Dev Notes

- `src/zkConsensusEnvelope.js` defines the canonical envelope and verifier result hashes.
- `src/zkWasmVerifier.js` loads `wasm/tlzk_verifier/pkg-node` in Node, with a web package fallback.
- `wasm/tlzk_verifier` contains the Rust verifier source.
- `browser/tlzk_consensus_zk_worker.js` is the browser/Electron worker template for non-blocking verification.
- `npm run test:zk-batch` exercises the envelope, compact tx34 payload, and verifier fallback.
- `npm run wasm:check` checks the Rust crate.
- `npm run wasm:bundle` builds the wasm target and runs `wasm-bindgen` into `wasm/tlzk_verifier/pkg-node` and `wasm/tlzk_verifier/pkg` when the `wasm-bindgen` CLI is installed.

Proof generation belongs on the `snacksack` host. Local wallet and consensus machines should verify envelopes and WASM artifacts, but they should not run the heavy proving path.

Until the parser has witness extraction wired in, tx34 rejects ZK batch movement envelopes that are not supplied by the caller. `TL_ZK_ALLOW_ANCHOR_ONLY=1` exists only for local anchor plumbing tests and should not be used for consensus.
