# Binohash Experimental Adapter

This folder contains an experimental, opt-in transition-commitment adapter for tx30 relay settlement checks.

- Commitment style: binary hash tree over transition hashes
- Leaf hash: `sha256("binohash:leaf:" + transitionHashHex)`
- Parent hash: `sha256("binohash:node:" + left + ":" + right)`

This is **not** a full implementation of any external paper specification. It is a local experimental adapter for evaluating:

- compact transition inclusion checks,
- deterministic dispute payload structure, and
- compatibility with existing tx30 state-root gating.

## Runtime Gate

Enable with:

`TL_ORACLE_REQUIRE_STATE_ROOT=1`
`TL_ORACLE_STATE_COMMIT_SCHEME=binohash`

Expected relay payload shape:

- `balancePayloadB64` decodes to JSON containing `binohash.root` (or `binoRoot`) and `stateRoot`
- `settlement.transitionHash` present
- `settlement.binoProof` array of `{ side: "L"|"R", hash: <hex32> }`

