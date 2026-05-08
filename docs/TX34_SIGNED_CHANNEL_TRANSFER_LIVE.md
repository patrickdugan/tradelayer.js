# Tx34 Signed Channel Transfer Live Receipt

Date: 2026-05-08

This is the live harness for tx34 applying a ZK-bound, user-signed descendant chain of channel transfers to TradeLayer channel balances. It demonstrates an L3-style shape: signed unpublished L2 channel movements, remote STWO proof receipt, and one tx34 L1 protocol movement that updates channel state.

## Run

- Inspect signing flow: `npm run zk:channel-transfer:sign`
- Build fixture: `npm run zk:channel-transfer:build`
- Remote proof: `npm run zk:channel-transfer:prove:snacksack`
- Local consensus verification: `npm run zk:channel-transfer:live`

The proof was generated on snacksack:

```text
C:\projects\tradelayer.js\artifacts\snacksack_proof_runs\tlzk-20260508-170058
```

## Receipt

- Verifier mode: `rust-wasm`
- Envelope ID: `5108eb6a78648793e996d7e924e9bb3309e8ab4806cfa2f501c0d85a11d09e2f`
- Tx34 local txid: `1bc41ef727ba54700c55b4b615236b0b62aff8c5a4ddcff6a39ddb573104131f`
- STWO batch ID: `7636708b1a9a3d1a7baf14f9f60714ea06cf31b64a38096f70cdd53ff71a80a1`
- Channel path intent hash: `9727f4c91cd5da6851c6b73558231a11ef38f0848fd5574d65f1719e4cf1677c`
- Channel path signing transcript hash: `05aa34ecdeb427b576484387c259d368cd301cdfcdc425045839d2c6b5e2559e`
- Signed channel-transfer batch hash: `ff9495ef3f456e3709268ce0061a0906b10d1bf5ea7b0477e4566fbf98f19acf`
- Signed channel-transfer execution hash: `267837ebb9cefe104456e8f1296bbf1ab19a9374a298814e39e937181cb8a1f5`
- Channel signature root: `6efebf92c2c4d8d2c4de682ecb0dd1b2918f0708d9208fd2cd0fde441ba5a211`
- Max dependency depth: `3`

## Execution Roots

- Input state root: `f38ffa3fbc519d1c2ff3b6007d2c103a076bd5354d538b8bae3e78acc3c77685`
- Output state root: `40fea952550455aa232697df3c153233a55290313073f33a7f7380c50093d33b`
- Balance transition root: `8699f7e869d020072eebd773de825eab065733992227a6231c0836b05afaae67`
- Step root: `372dfde7280c7cff7a774dba20da38a8a3cc8b9c39bccfb718bc05d0df2b11d4`
- Descendant root: `6c680024a7f65f698207c83681b4b4feeea1f21ea1ea29ad66644881404f3c3b`
- Authorization root: `ea33c5c798a0fab70c5962a07996f5bebddacacfb5aa90d06d9d5890b800fe66`
- Conservation root: `9ef8880d9cbf1c2b08a766d9847c10c6c1381aba0983cecf6d98fda1aa9449b2`

## User Signing

The fixture now separates the route intent from the signatures:

- Intent: `artifacts/zk_signed_channel_transfer/channel_path_intent_latest.json`
- Signing transcript: `artifacts/zk_signed_channel_transfer/user_signed_channel_path_latest.json`

Each hop signs the canonical transfer core with both the user key and channel-operator key. The demo uses deterministic keys unless `TL_ZK_CHANNEL_USER_PRIVKEY_HEX` and `TL_ZK_CHANNEL_OPERATOR_PRIVKEY_HEX` are provided.

## Descendant Chain

All three L2 transfers are signed but unpublished. Transfer 2 depends on transfer 1, and transfer 3 depends on transfer 2.

```text
tb1qzkchan000000000000000000000000000000:A  -> tb1qzkrelay10000000000000000000000000000:A
tb1qzkrelay10000000000000000000000000000:A  -> tb1qzkrelay20000000000000000000000000000:A
tb1qzkrelay20000000000000000000000000000:A  -> tb1qzkdest000000000000000000000000000000:A
```

## State Change

Property `1` moved `1.25` token units through the descendant path. The relays end flat, and only the final net movement remains at the tx34 settlement boundary.

```text
tb1qzkchan000000000000000000000000000000:A:1  5.00 -> 3.75
tb1qzkrelay10000000000000000000000000000:A:1  0.00 -> 0.00
tb1qzkrelay20000000000000000000000000000:A:1  0.00 -> 0.00
tb1qzkdest000000000000000000000000000000:A:1   0.00 -> 1.25
```

The tx34 envelope binds:

- snacksack STWO proof summary
- signed L1 carrier hex hash
- signed TradeLayer L2 batch hex hash
- 2-of-2 secp256k1 channel signatures
- channel transfer movement root
- user route intent hash
- user/channel-operator signing transcript hash
- channel execution witness roots for pre-state, post-state, per-step state, descendant edges, authorization, and conservation

The STWO proof currently proves the batch public-data binding. TradeLayer consensus then verifies the 2-of-2 secp256k1 signatures and refuses to apply the movement unless the execution witness reconstructs the exact current pre-state rows, every descendant dependency, each step root, the final post-state rows, authorization root, and value-conservation root.
