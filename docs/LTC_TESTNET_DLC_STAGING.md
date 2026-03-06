# LTC Testnet DLC Staging

## What Was Added
- Live harness: `tests/dlcLiveIntegration.js`
- Tx builders:
  - `TxUtils.createGrantManagedTokenTransaction(...)`
  - `TxUtils.createRedeemManagedTokenTransaction(...)`
  - `TxUtils.createStakeFraudProofTransaction(...)`
- NPM script: `npm run test:dlc-live`

## Flow Staged By Harness
1. Activate tx types `2,11,12,13,14,27,30`.
2. Create state oracle (tx13).
3. Issue procedural receipt token (tx1 with `proceduralType`).
4. Seed procedural template/contract in registry.
5. Stake bad oracle in collateral property (tx30 action=0).
6. Move collateral token (tLTC/property 1) from multiple depositors to vault (tx2).
7. Mint receipt token to depositors (tx11).
8. Trade receipt token between depositors (tx2).
9. Stage derivative option trade (tx27) and call option expiry settlement.
10. Submit good signed relay (tx30 action=2) with auto-roll.
11. Submit bad relay (expected invalid on immediate-apply).
12. Submit fraud proof slash (tx30 action=1).
13. User redemption (tx12) + collateral release transfer (tx2).

## Required Env
- `TL_ADMIN_ADDRESS`
- `TL_ORACLE_ADMIN_ADDRESS`
- `TL_BAD_ORACLE_ADDRESS`
- `TL_CHALLENGER_ADDRESS`
- `TL_DEPOSITORS` (comma-separated, at least 2)

## Recommended Env
- `TL_DRY_RUN=true` for first pass
- `TL_APPLY_IMMEDIATE=true` to decode+apply to local protocol state while staging
- `WALLET_NAME=wallet.dat` (or your wallet name)
- `RPC_WALLET=wallet.dat` if wallet-scoped RPC is needed
- `CHAIN=LTCTEST`
- `RPC_HOST`, `RPC_PORT`, `RPC_USER`, `RPC_PASS`

## Example
```powershell
$env:CHAIN='LTCTEST'
$env:WALLET_NAME='wallet.dat'
$env:RPC_WALLET='wallet.dat'
$env:TL_DRY_RUN='true'
$env:TL_APPLY_IMMEDIATE='true'
$env:TL_ADMIN_ADDRESS='tltc1...'
$env:TL_ORACLE_ADMIN_ADDRESS='tltc1...'
$env:TL_BAD_ORACLE_ADDRESS='tltc1...'
$env:TL_CHALLENGER_ADDRESS='tltc1...'
$env:TL_DEPOSITORS='tltc1...,tltc1...'
npm run test:dlc-live
```

## Current Note
- A dry-run preflight in this environment returned `ETIMEDOUT` from RPC, so you should verify daemon connectivity/auth before broadcast staging.
- Quick check:
```powershell
litecoin-cli -testnet -rpcwallet=wallet.dat getblockchaininfo
litecoin-cli -testnet -rpcwallet=wallet.dat getwalletinfo
```

