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
- `publicInputs.verifierWasmHash`: the consensus-approved verifier identity.
- For signed channel transfers, `publicInputs` also bind `signedChannelTransferExecutionHash`, `channelInputStateRoot`, `channelOutputStateRoot`, `channelBalanceTransitionRoot`, `channelStepRoot`, `channelDescendantRoot`, `channelAuthorizationRoot`, and `channelConservationRoot`.
- User-path demos additionally bind `channelPathIntentHash` and `channelPathSigningTranscriptHash`.

Consensus validation checks the compact OP_RETURN fields against the envelope, verifies the envelope hash structure, and calls the packaged Rust/WASM verifier. The `tlzk_rust_wasm_v0` switch currently pins the approved WASM artifact to:

```text
845dc849bcc4c789baec915badc10f95b9b8ab1a8abdda24d5b1d34dacaa06d9
```

The loader hashes `tlzk_verifier_bg.wasm` before accepting it. The envelope must bind that hash in `publicInputs.verifierWasmHash`, and the verifier result must echo it in `resultCore.wasmCodeHash`. The deterministic JS verifier is now an explicit development fallback only when `TL_ZK_ALLOW_JS_VERIFIER_FALLBACK=1` is set.

## Consensus Effect

After verification, `Logic.zkBatchMove` applies every movement:

1. Debit `movement.from`.
2. Credit `movement.to`.
3. Record an audit row in `zkBatchMovements` keyed by `envelopeId`.

Amounts are carried as integer `amountUnits` and converted to 8-decimal token amounts for the current tally map.

For a signed channel-transfer batch, the tally movement is skipped and the channel path is used instead. The execution witness must reconstruct the pre-state rows currently in the channel DB, the post-state rows after the transfer chain, the per-step state roots, the descendant dependency edges, the 2-of-2 signer authorization root, and an equal debit/credit conservation root before any channel balance is written.

Descendant transfers are encoded by signing `dependsOnTransferIds` inside each transfer core. During execution, a transfer can only depend on transfer ids already seen earlier in the batch, so an unpublished child cannot be applied before the unpublished parent whose output it spends.

## Dev Notes

- `src/zkConsensusEnvelope.js` defines the canonical envelope and verifier result hashes.
- `src/zkWasmVerifier.js` loads `wasm/tlzk_verifier/pkg-node` in Node, with a web package fallback.
- `wasm/tlzk_verifier` contains the Rust verifier source.
- `browser/tlzk_consensus_zk_worker.js` is the browser/Electron worker template for non-blocking verification.
- `npm run test:zk-batch` exercises the envelope, compact tx34 payload, and verifier fallback.
- `npm run wasm:check` checks the Rust crate.
- `npm run wasm:bundle` builds the wasm target and runs `wasm-bindgen` into `wasm/tlzk_verifier/pkg-node` and `wasm/tlzk_verifier/pkg` when the `wasm-bindgen` CLI is installed.
- `npm run zk:channel-transfer:build` creates a signed tx22-style channel transfer batch.
- `npm run zk:channel-transfer:sign` prints the user route intent, per-hop message hashes, dependency ids, and signer roles.
- `npm run zk:channel-transfer:prove:snacksack` sends that batch to snacksack for STWO proving.
- `npm run zk:channel-transfer:live` verifies the returned proof envelope and applies the channel balance update in an isolated local DB.

Proof generation belongs on the `snacksack` host. Local wallet and consensus machines should verify envelopes and WASM artifacts, but they should not run the heavy proving path.

Until the parser has witness extraction wired in, tx34 rejects ZK batch movement envelopes that are not supplied by the caller. `TL_ZK_ALLOW_ANCHOR_ONLY=1` exists only for local anchor plumbing tests and should not be used for consensus.
