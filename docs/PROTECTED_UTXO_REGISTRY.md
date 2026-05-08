# Protected UTXO Registry

Date: 2026-05-08

TradeLayer prototypes use ordinary Bitcoin Core wallets to carry objects that Core does not understand: tx33 colored refs, TAP-style commitment refs, DLC/BitVM funding refs, and future Ark/ASP refs. Bitcoin Core only sees spendable satoshis. The protected UTXO registry marks those outpoints as protocol objects before coin selection can consume them as fees.

## Model

The registry is a persistent JSON file. By default:

```text
artifacts/protected-utxos.json
```

Each protected entry records:

- `txid:vout`
- protection kind, such as `tap-asset-ref`, `colored-coin-ref`, or `dlc-bitvm-ref`
- address, label, amount, commitment id, and reason
- whether the current Bitcoin Core wallet has been asked to lock the outpoint

Bitcoin Core's `lockunspent` state is wallet-local and should be treated as volatile. The registry is the durable source of truth; `lockunspent` is just the adapter used before Core wallet funding.

## Commands

Mark every currently unspent wallet output with a label:

```text
node scripts\protectBtctestUtxos.js --bitcoin-bin=<bitcoin-core-bin> --datadir=<bitcoin-testnet-datadir> --wallet=utxoref-testnet --label=tlzk-tx33-tap-ref --kind=tap-asset-ref --reason="tx33 TAP/colored ref carrier"
```

Mark one explicit outpoint:

```text
node scripts\protectBtctestUtxos.js --txid=<txid> --vout=<n> --address=<address> --kind=dlc-bitvm-ref --reason="DLC/BitVM funding ref"
```

Reapply wallet locks after Bitcoin Core restart:

```text
node scripts\protectBtctestUtxos.js --bitcoin-bin=<bitcoin-core-bin> --datadir=<bitcoin-testnet-datadir> --wallet=utxoref-testnet --relock --list
```

The tx34 Bitcoin testnet broadcaster enforces this registry by default. It filters protected outpoints during explicit admin-address coin selection, and it applies `lockunspent` before any operator-enabled wallet coin selection.

To bypass the guard for emergency repair only:

```text
node scripts\broadcastBtctestTx34ZkAnchor.js --ignore-protected-utxos ...
```

## Why This Exists

Taproot Assets-aware software can preserve asset commitments while spending the carrier output. Plain Bitcoin Core cannot. If Core spends a TAP/colored reference UTXO as a fee input, the Bitcoin transaction is valid, but the higher-layer object can be burned or detached from its proof chain. This registry makes that distinction explicit in the prototype until the spend path is delegated to a TAP-aware wallet or daemon.
