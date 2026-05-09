# Tx34 ZK Batch Movement Draft

Date: 2026-05-08

Tx34 now has a draft ZK batch-movement mode. Legacy cross-layer bridge payloads are still decodable, but a payload beginning with `z1|` is treated as a ZK-verified token movement batch.

## Shape

The OP_RETURN stays compact:

```text
z1|envelopeId|movementRoot|proofHash|verifierId|proofType|programHash|publicInputHash|daBlobHash|signedL1TxHash|batchL2TxHash|resultId|envelopeRef
```

For standard-policy anchoring, tx34 can use the minimal form:

```text
z2|envelopeId
```

The `z2` form fits under the 80-byte OP_RETURN policy budget with the normal `tl` marker and tx type prefix. Consensus resolves the DA envelope by `envelopeId`, fills the compact fields from the envelope, and then runs the same hash, pinned-verifier, proof, signature, dependency, and conservation checks.

The full consensus object is the ZK envelope, normally supplied from witness/DA:

- `signedL1Tx.hex`: signed Bitcoin transaction hex.
- `batchL2Tx.hex`: signed TradeLayer L2 batch transaction hex, including the 2-of-2 channel signature material the prover bound.
- `movements`: token debits and credits in base units.
- `daBlob`: witness or external DA object carrying proof context.
- `verifierResult`: bounded Rust/WASM verifier result committed by `resultId`.
- `publicInputs.verifierWasmHash`: the consensus-approved verifier identity.
- For signed channel transfers, `publicInputs` also bind `signedChannelTransferExecutionHash`, `channelInputStateRoot`, `channelOutputStateRoot`, `channelBalanceTransitionRoot`, `channelStepRoot`, `channelDescendantRoot`, `channelAuthorizationRoot`, and `channelConservationRoot`.
- User-path demos additionally bind `channelPathIntentHash` and `channelPathSigningTranscriptHash`.

Consensus validation resolves the envelope from direct witness data, embedded development data, a local DA file, or an explicitly enabled HTTP DA endpoint. It then checks the compact OP_RETURN fields against the resolved envelope, verifies the envelope hash structure, and calls the packaged Rust/WASM verifier. The `tlzk_rust_wasm_v0` switch currently pins the approved WASM artifact to:

```text
845dc849bcc4c789baec915badc10f95b9b8ab1a8abdda24d5b1d34dacaa06d9
```

The loader hashes `tlzk_verifier_bg.wasm` before accepting it. The envelope must bind that hash in `publicInputs.verifierWasmHash`, and the verifier result must echo it in `resultCore.wasmCodeHash`. The deterministic JS verifier is now an explicit development fallback only when `TL_ZK_ALLOW_JS_VERIFIER_FALLBACK=1` is set.

For local DA, the parser resolves `zkda:<envelopeId>` or a `z2` `envelopeId` by looking for `<envelopeId>.json` under `TL_ZK_ENVELOPE_DIRS` or, by default, `artifacts/zk_envelopes`, `artifacts/zk_signed_channel_transfer`, and `artifacts/zk_consensus`. HTTP DA is disabled unless `TL_ZK_DA_ALLOW_HTTP=1`; after fetch, the same envelope id, compact field, verifier hash, proof hash, and DA hash checks still run.

## Consensus Effect

After verification, `Logic.zkBatchMove` applies every movement:

1. Debit `movement.from`.
2. Credit `movement.to`.
3. Record an audit row in `zkBatchMovements` keyed by `envelopeId`.

Amounts are carried as integer `amountUnits` and converted to 8-decimal token amounts for the current tally map.

For a signed channel-transfer batch, the tally movement is skipped and the channel path is used instead. The execution witness must reconstruct the pre-state rows currently in the channel DB, the post-state rows after the transfer chain, the per-step state roots, the descendant dependency edges, the 2-of-2 signer authorization root, and an equal debit/credit conservation root before any channel balance is written.

Descendant transfers are encoded by signing `dependsOnTransferIds` inside each transfer core. During execution, a transfer can only depend on transfer ids already seen earlier in the batch, so an unpublished child cannot be applied before the unpublished parent whose output it spends.

For a tx2 send batch, the DA blob can carry `tx2SendBatch`:

```json
{
  "kind": "tl_zk_tx2_send_batch",
  "batchCore": {
    "protocol": "tl_zk_tx2_send_batch_v1",
    "sends": [
      {
        "protocol": "tradelayer_tx2_send_v1",
        "sender": "tb1q...",
        "recipient": "tb1q...",
        "propertyId": 1,
        "amountUnits": "125000000",
        "nonce": "send-1"
      }
    ],
    "inputStateRoot": "...",
    "outputStateRoot": "...",
    "movementRoot": "...",
    "batchHash": "..."
  }
}
```

Consensus recomputes the send batch hash, input root, output root, and movement root from the batch. It rejects the envelope if those roots differ from `publicInputs.tx2SendBatchHash`, `publicInputs.tx2InputStateRoot`, `publicInputs.tx2OutputStateRoot`, or the envelope movement root. During tx34 validity, it also rebuilds the current touched tally rows and requires the root to match the proved input root before `Logic.zkBatchMove` can apply the movements. This makes tx34 a ZK-compressed tx2 send batch: many tx2-style transfers, one proof envelope, one anchor, and one audited state update.

For PNL settlement, the DA blob can carry `pnlSettlementBatch` covering the two PNL settlement surfaces:

```json
{
  "kind": "tl_zk_pnl_settlement_batch",
  "batchCore": {
    "protocol": "tl_zk_pnl_settlement_batch_v1",
    "settlements": [
      {
        "protocol": "tradelayer_tx23_net_settle_v1",
        "txType": 23,
        "settleType": 2,
        "channelAddress": "tb1q...",
        "propertyId": 1,
        "amountUnits": "75000000",
        "payerColumn": "A",
        "receiverColumn": "B",
        "nonce": "tx23-net"
      },
      {
        "protocol": "tradelayer_tx31_king_settle_v1",
        "txType": 31,
        "settleType": 3,
        "channelAddress": "tb1q...",
        "propertyId": 1,
        "amountUnits": "25000000",
        "payerColumn": "B",
        "receiverColumn": "A",
        "blockStart": 100,
        "blockEnd": 120,
        "channelRoot": "...",
        "nonce": "tx31-king"
      }
    ],
    "inputStateRoot": "...",
    "outputStateRoot": "...",
    "settlementRoot": "...",
    "movementRoot": "...",
    "batchHash": "..."
  }
}
```

The movement layer uses `channel:<channelAddress>:A` and `channel:<channelAddress>:B` pseudo-addresses, matching the signed-channel ZK convention. Consensus recomputes `pnlSettlementBatchHash`, `pnlSettlementRoot`, `pnlInputStateRoot`, `pnlOutputStateRoot`, and the envelope movement root. During tx34 validity it also reloads the touched channel rows from `Channels.getChannel` and rejects stale proofs before accepting the verifier result.

## Dev Notes

- `src/zkConsensusEnvelope.js` defines the canonical envelope and verifier result hashes.
- `src/zkTx2SendBatch.js` defines the tx2 send-batch witness shape and row-root checks.
- `src/zkPnlSettlementBatch.js` defines tx23 NET_SETTLE and tx31 KING_SETTLE witness shapes and channel row-root checks.
- `src/zkWasmVerifier.js` loads `wasm/tlzk_verifier/pkg-node` in Node, with a web package fallback.
- `wasm/tlzk_verifier` contains the Rust verifier source.
- `browser/tlzk_consensus_zk_worker.js` is the browser/Electron worker template for non-blocking verification.
- `npm run test:zk-batch` exercises the envelope, compact tx34 payload, and verifier fallback.
- `npm run wasm:check` checks the Rust crate.
- `npm run wasm:bundle` builds the wasm target and runs `wasm-bindgen` into `wasm/tlzk_verifier/pkg-node` and `wasm/tlzk_verifier/pkg` when the `wasm-bindgen` CLI is installed.
- `npm run zk:channel-transfer:build` creates a signed tx22-style channel transfer batch.
- `npm run zk:channel-transfer:sign` prints the user route intent, per-hop message hashes, dependency ids, and signer roles.
- `npm run zk:channel-transfer:prove:snacksack` sends that batch to snacksack for STWO proving.
- `npm run zk:channel-transfer:live` writes a local DA envelope record, verifies a minimal `z2|<envelopeId>` tx34 anchor against the returned proof envelope, and applies the channel balance update in an isolated local DB.

Proof generation belongs on the `snacksack` host. Local wallet and consensus machines should verify envelopes and WASM artifacts, but they should not run the heavy proving path.

Until remote witness extraction is wired in, tx34 rejects anchors whose envelope cannot be resolved from direct params, local DA, or explicitly enabled HTTP DA. `TL_ZK_ALLOW_ANCHOR_ONLY=1` exists only for local anchor plumbing tests and should not be used for consensus.
