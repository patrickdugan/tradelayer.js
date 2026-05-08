# Tx34 Signed Channel Transfer Live Receipt

Date: 2026-05-08

This is the first live harness for tx34 applying a ZK-bound, signed channel transfer to TradeLayer channel balances.

## Run

- Build fixture: `npm run zk:channel-transfer:build`
- Remote proof: `npm run zk:channel-transfer:prove:snacksack`
- Local consensus verification: `npm run zk:channel-transfer:live`

The proof was generated on snacksack:

```text
C:\projects\tradelayer.js\artifacts\snacksack_proof_runs\tlzk-20260508-160150
```

## Receipt

- Verifier mode: `rust-wasm`
- Envelope ID: `4d4d917863a178d51a3543c1a3221ae69188a2b5262e51586abf9d74550d8a23`
- Tx34 local txid: `ab371668502f19b8d9e5d30a7afce4e9f16e9f49ac4d66d3b68d204a2ded9a87`
- STWO batch ID: `4e96e04e09230f124a06a21d0b151a8d0f5f4e21bbf69b3b8629702120c8bbe5`
- Signed channel-transfer batch hash: `4002368d1be40b70cbae63b113f0e659ab512ef32bcf36fc295c06a2bbd6a71d`
- Channel signature root: `ceed4b6f6ef4133f3200f909d62e660f9ad64790c66d980bb4bcd79ff340dff4`

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

The STWO proof currently proves the batch public-data binding. TradeLayer consensus still performs the explicit secp256k1 signature checks before applying the channel balance movement.
