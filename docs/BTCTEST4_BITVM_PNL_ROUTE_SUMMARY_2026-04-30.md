# Bitcoin Testnet4 BitVM PNL Route Summary

Date: 2026-04-30

This note summarizes the local Bitcoin testnet4 run that routes a TradeLayer derivative PNL result into a DLC-held UTXO and verifies the payout through the UTXORef/BitVM commitment adapter.

The run is intentionally small because testnet BTC was scarce. The mechanics are the important part: a spot mark is anchored on-chain, a bilateral perp is opened and closed within the protocol price guard, a state-oracle witness reveal publishes the PNL route, and the DLC UTXO is swept according to a UTXORef payout commitment.

## Artifact

Primary artifact:

`artifacts/btctest-e2e-pnl-perp-route-flow-latest.json`

Run id:

`1777576777533-372c6e58`

Chain:

`bitcoin-testnet4`

## Addresses

| Role | Address |
| --- | --- |
| Long / payout recipient | `tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu` |
| Short / PNL payer | `tb1qhreqkc3097ayn76w69wu8f4p8zv78mw0az0jkl` |
| DLC funding address | `tb1qrmcnyrvggwzwphzhpr4ucdfnuzkj92tmul6200fnmwv7hqku6dnqa0ddx3` |
| DLC party A key address | `tb1qehgxrdly88lcgwury7a9awyqaszldcp572dlq0` |
| DLC party B key address | `tb1qh46w05p20tn40vjsah2mqtv9wz9tslhxtfv3xh` |
| Spot mark channel address | `tb1qv2s706vkqs0kak6kavkjn6tmvx9y3g06pa75kp` |
| Spot token delivery address | `tb1q6wz2f4xgck5w8k2fvqthmg42xk3j3q90c5qlja` |

## On-Chain Transactions

| Step | Txid |
| --- | --- |
| Spot mark anchor | [`8e83e3bc3895c4c39cdd7f2decc253fd5fd5335dd17edaae635e3aefa8a9c202`](https://mempool.space/testnet4/tx/8e83e3bc3895c4c39cdd7f2decc253fd5fd5335dd17edaae635e3aefa8a9c202) |
| DLC / BitVM funding grant | [`494bafa9c04ccc889e0bed07f1e87bc724cc6fdf003e7df04dd20bd04dee9413`](https://mempool.space/testnet4/tx/494bafa9c04ccc889e0bed07f1e87bc724cc6fdf003e7df04dd20bd04dee9413) |
| Oracle witness commit | [`b08f0d140c9e68b336cdf03a89cb130bb4062316e804cbc90ae1229b363097c9`](https://mempool.space/testnet4/tx/b08f0d140c9e68b336cdf03a89cb130bb4062316e804cbc90ae1229b363097c9) |
| Oracle witness reveal | [`238bd5097480d0e97e4278882397ebd68201ff31f80036e79f882f7e2070e643`](https://mempool.space/testnet4/tx/238bd5097480d0e97e4278882397ebd68201ff31f80036e79f882f7e2070e643) |
| DLC payout spend | [`0011b1f59919f2161e03b60153b32cbd260d0a0ba365fe313dff1256c9d9fabd`](https://mempool.space/testnet4/tx/0011b1f59919f2161e03b60153b32cbd260d0a0ba365fe313dff1256c9d9fabd) |

## TradeLayer Path

| Field | Value |
| --- | --- |
| Spot pair | `0-5` |
| Spot property id | `5` |
| PNL / procedural property id | `380` |
| Perp contract id | `6` |
| Entry price | `2200` |
| Exit price | `2244` |
| Open mark | `2200` |
| Close mark | `2200` |
| Close deviation | `200 bps` |
| Max allowed deviation | `500 bps` |
| Notional | `0.01` |
| Long realized PNL | `0.00000009` token units |
| Short realized PNL | `-0.00000009` token units |

The open was exactly at the spot mark. The close was 2% away from the mark, so it passed the 5% validity guard.

## DLC / Script Details

DLC funding output:

```text
txid: 494bafa9c04ccc889e0bed07f1e87bc724cc6fdf003e7df04dd20bd04dee9413
vout: 0
address: tb1qrmcnyrvggwzwphzhpr4ucdfnuzkj92tmul6200fnmwv7hqku6dnqa0ddx3
amount: 1000 sats
```

DLC witness script:

```text
5221020699940368cb971bc501639df8fe82830ab98dd1c001ac46d97ea5d123f803dd2102913b2c5a31acd6a4426758938162e7280773f40477563fd4563efd3cb59274e652ae
```

DLC pubkeys:

```text
020699940368cb971bc501639df8fe82830ab98dd1c001ac46d97ea5d123f803dd
02913b2c5a31acd6a4426758938162e7280773f40477563fd4563efd3cb59274e6
```

Payout:

```text
recipient: tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu
amount: 700 sats
fee: 300 sats
input: 1000 sats
```

## Oracle Attestation

The state oracle witness reveal commits to the PNL route. The route is too large and stateful to push directly into a minimal OP_RETURN-only path, so the reveal carries a structured witness payload and the BitVM/UTXORef side verifies the compact commitments derived from it.

```text
eventId: btctest-pnl-e2e-1777576777533-372c6e58-pnl-route-5dca5ee9
outcome: PNL_ROUTE
payloadHash: 27e31910926704be8ab21d8da77b15e28e7dd4985e4faf5f5b3d4f3ded022430
oraclePubkey: 035f2fab5a5bd6932926d1d51ad3ae763efe9e7e633ad5ef053e45374b4f4a5631
signature: 7a421d6ba91ac80e230883907e115a5478fb21e5a5bc8df3087664f2a2b7976f63197eac776a6fc1be267d03b87696277fea63c7afdc9cda999719a4c0cf9693
```

## UTXORef / BitVM Commitment Circuit

The current prototype uses the UTXORef adapter as the deterministic commitment circuit for the route. The production BitVM version should turn these checks into challengeable script fragments rather than trusting a local JS verifier.

Public inputs:

```text
epochId: 4942129157988333337
withdrawalRoot: fccca08ecd0b13f708b3581c1e19ba5ce9b65dda4cd0c8c121b1ff29dfc9dcd8
commitmentHash: af6232022dbb2c66a009633cb1d56cd6fb8d6a942aa1273525a58c0725541148
planHash: eea70514391625e63ad4c4f69b54e2b66dff2cb60a4c90ff0cfc1bc5571e0969
routeHash: ded899b1626d8cc058d182504f881b76a26ed25c9b60414cfecdb7357fca45cd
payoutVectorHash: e7322ecfe1e2357c52b485846b864ca0fe30579270a5d19dd51c5b2129c6478f
tokenPnlHash: c6a958c5fd63da4e374ff8032656da98a12c76e0d91aaebf8610edc62e15f5a0
```

Payout leaf:

```text
epochId: 4942129157988333337
recipient: tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu
amount: 700 sats
```

Circuit checks:

1. Recompute the route plan hash from `revealTxid`, `payloadHash`, `dlcRef`, DLC input, and output plan.
2. Decode the payout address into a Bitcoin testnet4 scriptPubKey.
3. Build the payout leaf as `epochId || amountSats || recipientScriptPubKey`.
4. Hash the payout leaf with the `UTXO_REFEREE_V1` domain separator.
5. Recompute the payout Merkle root and require it to equal `withdrawalRoot`.
6. Serialize the commitment package as `epochId || withdrawalRoot || capSats || residualDest`.
7. Require `SHA256(commitmentPackage)` to equal `commitmentHash`.
8. Require sweep accounting: `payoutSats + feeSats == dlcInputSats`.
9. Require the observed DLC spend output to match the committed recipient and amount.
10. Bind the sweep to the oracle reveal by checking the payload hash and route plan hash.

Observed verifier result:

```json
{
  "ok": true,
  "recomputedPlanHash": "eea70514391625e63ad4c4f69b54e2b66dff2cb60a4c90ff0cfc1bc5571e0969",
  "withdrawalRootHex": "fccca08ecd0b13f708b3581c1e19ba5ce9b65dda4cd0c8c121b1ff29dfc9dcd8",
  "commitmentHashHex": "af6232022dbb2c66a009633cb1d56cd6fb8d6a942aa1273525a58c0725541148",
  "epochId": "4942129157988333337",
  "payoutTotalSats": "700",
  "feeSats": "300"
}
```

## Minimal Architecture

```text
Bitcoin testnet4 tx3 spot mark
        |
        v
TradeLayer perp open/close validity
        |
        v
State oracle PNL route witness reveal
        |
        v
UTXORef payout commitment
        |
        v
DLC-held UTXO swept to PNL recipient
```

The point of the demo is not that TradeLayer consensus has been fully implemented inside BitVM. The point is narrower and testable: a state-oracle-published PNL route can be reduced into a compact UTXO payout commitment, and the DLC-held UTXO can be swept only along the committed payout path.

## Local Node Status

The run used local Bitcoin Core testnet4:

```text
datadir: D:\BitcoinTestnet
wallet: utxoref-testnet
chain: testnet4
height at final check: 133130
pruned: true
initialblockdownload: false
```

