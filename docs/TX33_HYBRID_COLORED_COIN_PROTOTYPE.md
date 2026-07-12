# Tx33 Hybrid Colored Coin Prototype

Tx type 33 is the TradeLayer hook for exporting an account token into a
colored-UTXO style wrapper and later importing it back into account state.

The first prototype is intentionally conservative:

- `encodeDecodeRecode = 1` encodes a TradeLayer balance into a colored
  commitment by debiting the sender and recording the output/proof metadata.
- `encodeDecodeRecode = 0` decodes a recorded commitment back into TradeLayer
  balance exactly once.
- `encodeDecodeRecode = 2` recodes/repairs the output reference without moving
  TradeLayer balance.

## Stablecoin / LN Motivation

For the synthetic USD idea, TradeLayer remains the accounting and risk engine:

```text
BTC/USD perp collateral and PnL
  -> TradeLayer synthetic USD property
  -> tx33 colored/TAP-style commitment
  -> Taproot Assets / RFQ / LN Edge-node liquidity
  -> BitVM/DLC challengeable liquidity evidence
```

The BTC collateral can continue rolling through the DLC/BitVM state machine
while the user-facing stablecoin wrapper moves through Lightning-style routing
and RFQ surfaces.

## Payload Fields

The tx33 encoder remains backward-compatible with the original four fields and
adds optional prototype metadata:

```text
encodeDecodeRecode
propertyId
satsRatio
homeAddress
amount
coloredOutputRef
tapAssetId
proofRoot
rfqId
bitvmStatusRef
commitmentId
previousOutputRef
newColoredOutputRef
```

`amount` is encoded as 8-decimal base36 with a trailing `~`.

## Consensus Boundary

This prototype does not verify a real Taproot Asset proof yet. It creates and
mutates the TradeLayer-side commitment record so a later TAP/RGB/LRC20 proof
verifier can bind to:

- `tapAssetId`
- `proofRoot`
- `coloredOutputRef`
- `rfqId`
- `bitvmStatusRef`

The current safety invariant is simple: encoded balances are debited before the
colored wrapper is considered live, and decode can credit the balance back only
once.
