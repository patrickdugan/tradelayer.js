# Tx34 Signed Channel Transfer Live Receipt

Date: 2026-05-08

This is the live harness for tx34 applying a ZK-bound, signed descendant chain of channel transfers to TradeLayer channel balances. It demonstrates an L3-style shape: signed unpublished L2 channel movements, remote STWO proof receipt, and one tx34 L1 protocol movement that updates channel state.

## Run

- Build fixture: `npm run zk:channel-transfer:build`
- Remote proof: `npm run zk:channel-transfer:prove:snacksack`
- Local consensus verification: `npm run zk:channel-transfer:live`

The proof was generated on snacksack:

```text
C:\projects\tradelayer.js\artifacts\snacksack_proof_runs\tlzk-20260508-164251
```

## Receipt

- Verifier mode: `rust-wasm`
- Envelope ID: `ac099977df36282ec3538b7c9a6152ad2c3482c660767e945a4eace28002bcc8`
- Tx34 local txid: `93f09431328e3dbd75672c3f892dbad82bae1cec30b85caf1edfd8b0e4a585af`
- STWO batch ID: `1abb5b0503b579bb491daafcc98f603663518d647c23c13b9e1e89685e469770`
- Signed channel-transfer batch hash: `c93b524ca3d23a585555027752ed5cab69a4bc767832a359ee691b4f8fd14f90`
- Signed channel-transfer execution hash: `cb948597db02ecc94e92384a851a32cfbd802cf0573f444643e2314e022a7390`
- Channel signature root: `e5472d70339600002ee12eb1df3be6d268742fe9cfb428bca3a828be67393b7d`
- Max dependency depth: `3`

## Execution Roots

- Input state root: `f38ffa3fbc519d1c2ff3b6007d2c103a076bd5354d538b8bae3e78acc3c77685`
- Output state root: `40fea952550455aa232697df3c153233a55290313073f33a7f7380c50093d33b`
- Balance transition root: `c709829c1d87cfd39054d8dea1950e58f82a45319f652fb75b39a2e7b69cb5f2`
- Step root: `09fd8dab42e747389c451b5430c81dd5c2bdba22cc2a886e30fe1a6c209967e8`
- Descendant root: `dbaa6b2e0080baee53246576294b65278b1eef1ad937656a4cb58297b7e7c14f`
- Authorization root: `e864c5eed696de52b45458c5569dcbe906a34d5e68ee6311e00c9ba668ffdb55`
- Conservation root: `9ef8880d9cbf1c2b08a766d9847c10c6c1381aba0983cecf6d98fda1aa9449b2`

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
- channel execution witness roots for pre-state, post-state, per-step state, descendant edges, authorization, and conservation

The STWO proof currently proves the batch public-data binding. TradeLayer consensus then verifies the 2-of-2 secp256k1 signatures and refuses to apply the movement unless the execution witness reconstructs the exact current pre-state rows, every descendant dependency, each step root, the final post-state rows, authorization root, and value-conservation root.
