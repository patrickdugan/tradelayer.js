# Tx34 Signed Channel Transfer Live Receipt

Date: 2026-05-08

This is the live harness for tx34 applying a ZK-bound, signed channel transfer to TradeLayer channel balances. It demonstrates an L3-style shape: signed L2 channel movement, remote STWO proof receipt, and one tx34 L1 protocol movement that updates channel state.

## Run

- Build fixture: `npm run zk:channel-transfer:build`
- Remote proof: `npm run zk:channel-transfer:prove:snacksack`
- Local consensus verification: `npm run zk:channel-transfer:live`

The proof was generated on snacksack:

```text
C:\projects\tradelayer.js\artifacts\snacksack_proof_runs\tlzk-20260508-161729
```

## Receipt

- Verifier mode: `rust-wasm`
- Envelope ID: `be705e70444b19fd8118fd28a8a898379499a84d04889863fa65d29a3d011656`
- Tx34 local txid: `beebadc6d817e128b4e15043924b429a031f95d99211f7ea9dc7f700eead3c9c`
- STWO batch ID: `b156fbb0ce22d42ef10bb74868ef28ccc83e192dc5b4fd8c63b58a8289f70581`
- Signed channel-transfer batch hash: `4002368d1be40b70cbae63b113f0e659ab512ef32bcf36fc295c06a2bbd6a71d`
- Signed channel-transfer execution hash: `d705941cf8bbcb97f8acdc3bcb2504243d148453ab33b5cba120ce8f21685e28`
- Channel signature root: `ceed4b6f6ef4133f3200f909d62e660f9ad64790c66d980bb4bcd79ff340dff4`

## Execution Roots

- Input state root: `992dd6592ff2be3e415d4c5180cb594b31c05d92e586d1dc349a6887161ef30f`
- Output state root: `731afc9527cf7497a838a939b9303d82edda8290d1d031ba4ab3364d5680f308`
- Balance transition root: `f09fd130bad5e1458e5516d5bbc03de08781034c4de33de09d13dd256876b138`
- Authorization root: `e7b4a1d2ec1c266e177f9cc37fd1fbd46f58c0650bf9f1cce6bfc5b79fe85d9b`
- Conservation root: `1bb4d46bebb2f143ff98be1f41fffafe5d33f160a9257312fe71474de9362f91`

## State Change

Property `1` moved `1.25` token units from the source channel's A column to the destination channel's A column.

```text
tb1qzkchan000000000000000000000000000000:A:1  5.00 -> 3.75
tb1qzkchan2000000000000000000000000000000:A:1 0.00 -> 1.25
```

The tx34 envelope binds:

- snacksack STWO proof summary
- signed L1 carrier hex hash
- signed TradeLayer L2 batch hex hash
- 2-of-2 secp256k1 channel signatures
- channel transfer movement root
- channel execution witness roots for pre-state, post-state, authorization, and conservation

The STWO proof currently proves the batch public-data binding. TradeLayer consensus then verifies the 2-of-2 secp256k1 signatures and refuses to apply the movement unless the execution witness reconstructs the exact current pre-state rows, post-state rows, authorization root, and value-conservation root.
