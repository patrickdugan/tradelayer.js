# Testnet Activation Setup

This is the TradeLayer Bitcoin testnet activation set for the LN-BTC -> TLUSD -> tx33 colored/TAP wrapper demo.

## Activation Profile

Profile id: `bitvm-ln-tlusd-tx33`

Network label: `BTCTEST`

Activated tx types:

```text
0,1,2,4,11,12,13,14,16,18,19,20,21,22,23,24,25,26,27,30,31,33,34
```

Why these are included:

- `0,1,2,4`: genesis activation, token issue, sends, channel commits.
- `11,12`: managed/procedural receipt token grant and redemption.
- `13,14`: BTC/USD and BitVM/DLC state oracle creation and publication.
- `16,18,19,27`: BTC/USD perp/option series and on-chain/channel trades.
- `20,21,22,23,26,31`: channel token routing, withdrawals, transfers, PNL settlement, pay-to-token, batch settlement.
- `24,25`: TL synthetic USD mint and redeem.
- `30`: BitVM/DLC relay, stake, and fraud proof path.
- `33,34`: colored/TAP-style externalization and bridge metadata.

## Commands

Print the activation manifest:

```powershell
node scripts/setupTestnetActivationSet.js --mode=print
```

Write the activation registry to a sandbox NeDB root:

```powershell
node scripts/setupTestnetActivationSet.js --mode=local-db --db-root=nedb-sandbox
```

For `BTCTEST`, the manifest stays labeled `BTCTEST`, while the NeDB folder resolves to the existing TradeLayer convention `btc-test`.

Write it to the live listener's default DB root only when you intend the listener to consume it:

```powershell
node scripts/setupTestnetActivationSet.js --mode=local-db --db-root=nedb-data
```

Broadcast activation transactions from a funded testnet admin wallet:

```powershell
$env:CHAIN="BTC"
$env:TL_ACTIVATION_NETWORK="BTCTEST"
$env:TL_ADMIN_ADDRESS="tb1q..."
node scripts/setupTestnetActivationSet.js --mode=broadcast
```

## Follow-On Setup

After activation, the demo state should be staged in this order:

1. Issue the demo collateral/receipt/TLUSD properties as needed with tx1.
2. Create BTCUSD state and price oracles with tx13.
3. Publish price/state marks with tx14.
4. Create the BTCUSD perp contract series with tx16.
5. Commit liquidity into channels with tx4 and route channel trades with tx19/tx20.
6. Mint TLUSD synthetic exposure with tx24 and redeem with tx25.
7. Relay BitVM/DLC state and fraud evidence with tx30.
8. Externalize TLUSD into a TAP/colored commitment with tx33.
