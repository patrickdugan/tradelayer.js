# BTCTEST consensus check

TradeLayer can be pointed at Bitcoin Core testnet4 with the `BTCTEST` profile.
The runtime maps `CHAIN=BTCTEST` to the Bitcoin RPC client, the `btc-test`
NeDB namespace, and Core's testnet4 RPC port.

Required local environment:

```powershell
$env:BTCTEST_DATADIR = '<bitcoin-core-datadir>'
$env:BTCTEST_WALLET = 'utxoref-testnet'
$env:TL_NEDB_ROOT = 'nedb-sandbox'
npm run check:btctest-consensus
```

Equivalent direct command:

```powershell
node scripts/checkBtctestConsensus.js --datadir=<bitcoin-core-datadir> --wallet=utxoref-testnet --db-root=nedb-sandbox
```

The checker uses `<datadir>/testnet4/.cookie` for RPC authentication unless
`RPC_COOKIE_FILE`, `RPC_USER`, and `RPC_PASS` are provided explicitly. It writes
`artifacts/btctest-consensus-check-latest.json`.

Current checks:

- Bitcoin Core reports `chain=testnet4` and is out of initial block download.
- TradeLayer resolves the database profile to `btc-test`.
- BTCTEST activations are present for the tx types used by the cross-domain proof.
- The proof txids decode through the configured node or, for raw transactions no
  longer in the node wallet/mempool, through raw hex fetched from testnet4 and
  decoded by the local node.
- TradeLayer state and code consensus hashes are generated.
