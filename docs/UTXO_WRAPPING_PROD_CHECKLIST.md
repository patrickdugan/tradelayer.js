# UTXO Wrapping Production Checklist (BitVM + DLC Plan A)

Status key:
- `[x]` completed
- `[ ]` pending

## 1. Resolver Authorization Hardening `[x]`
- Enforce that `bitvm_resolve` can only be executed by the declared resolver identity.
- Reject relay payloads where `senderAddress` does not match `settlement.resolverAddress`.
- Cover this with adversarial tests.

## 2. Challenge Economics + Slashing `[x]`
- Implemented `cacheBondAmount/cacheBondPropertyId` lock on `bitvm_cache`.
- Implemented `challengeBondAmount/challengeBondPropertyId` lock on `bitvm_challenge`.
- Implemented deterministic resolve economics:
  - `uphold`: cache bond slashed to challenger; challenge bond returned.
  - `reject`: cache bond returned; challenge bond slashed to opener.
- Covered with adversarial tests.

## 3. On-chain Verifier/Challenge Integration `[ ]`
- Replace placeholder/protocol-only resolution with full BitVM challenge-game settlement source.
- Wire witness bundle verification to executable challenge contracts/UTXO flows.

## 4. Watchtower + Liveness `[ ]`
- Add automated watchers for pending cache windows and unresolved challenges.
- Alert and auto-submit required challenge/prove transactions before deadlines.

## 5. Wallet UX + Operator Controls `[ ]`
- Surface cache lifecycle states: `PENDING`, `CHALLENGED`, `RESOLVED_UPHELD`, `RELEASED`.
- Provide one-click actions for challenge/resolve/payout with role-safe gating.

## 6. Replay/Recovery Safety `[ ]`
- Prove replay determinism across reorg/restart for all BitVM cache transitions.
- Add replay gate artifacts and automatic consistency checks.

## 7. Security Review + Abuse Cases `[ ]`
- Add threat model for griefing, replay, censorship, key compromise, and stale-oracle attacks.
- Execute adversarial scenario suite and document residual risk.
