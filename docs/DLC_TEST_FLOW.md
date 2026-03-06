# DLC Test Flow (Current Implementation)

## Status
- Implemented: protocol-level DLC flow simulation with oracle relay, fraud slashing, procedural receipt token mint/redeem, auto-roll, and user redemption.
- Not yet implemented: full Bitcoin/Litecoin raw DLC transaction construction/signing/broadcast pipeline (funding tx, CET, refund tx generation from UTXO scripts).

## Relevant Transaction Types
- `tx11` Grant Managed Token
  - Extended fields: `dlcTemplateId`, `dlcContractId`, `settlementState`.
  - Procedural token mint is state-gated.
- `tx12` Redeem Managed Token
  - Extended fields: `dlcTemplateId`, `dlcContractId`, `settlementState`.
  - Procedural token redeem supports holder redemption path (state-gated).
- `tx30` Oracle Stake/Fraud/Relay
  - `action=0`: stake
  - `action=1`: fraud proof slash
  - `action=2`: relay state attestation
  - Extended relay fields: `settlementState`, `relayBlob`, `autoRoll`, `nextDlcRef`.

## Core Modules
- `src/procedural.js`
  - Registry for DLC templates/contracts and states.
  - Issuance gate: `ensureIssuanceContext(...)` (must be `FUNDED` or `OPEN`).
  - Redemption gate: `ensureRedemptionContext(...)` (must be `SETTLED` or `CLOSED`).
- `src/dlcOracleBridge.js`
  - Parses node-dlc-like relay blobs.
  - Verifies secp256k1 oracle signatures on canonical relay messages.
- `src/logic.js`
  - `processStakeFraudProof(...)` handles stake/fraud/relay.
  - Relay path optionally auto-rolls to `nextDlcRef` when `autoRoll=true`.

## "Commit Tx" in Current Tests
- Current tests treat "commit/deposit" as protocol ledger movements:
  - depositor balance debited in collateral property (tLTC/property `1`)
  - DLC vault address credited (e.g. `DLC::ct-1`)
  - procedural receipt token minted to depositor via `tx11` path.
- This is not yet a script-level UTXO funding transaction.

## Settlement Paths Covered

### 1) Good Oracle Relay (trusted path)
- Signed relay blob is validated.
- Contract state transitions (e.g. `FUNDED -> SETTLED`).
- Optional auto-roll seeds next contract (`nextDlcRef`) as `FUNDED`.

### 2) Bad Oracle Relay + Fraud Proof
- Invalid signature relay is rejected in validity.
- Fraud proof path (`tx30 action=1`) slashes staker balance.
- Challenger receives slash reward in staked property.

### 3) Profit Sweep
- Trusted oracle exit path simulated as vault-to-user balance sweep.

### 4) User-Declared Redemption
- After closure state, holder can redeem procedural receipt token (`tx12` path).
- Token burn and collateral release are executed in scenario.

## Executable Scenarios / Tests
- Full multi-party executable scenario:
  - `tests/dlcMultiDepositorScenario.js`
  - Run: `npm run test:dlc-scenario`
- Makeshift oracle signer helper:
  - `tests/makeshiftOracle.js`
- Additional coverage:
  - `tests/utxoDlcOracleFlow.test.js`
  - `tests/dlcRelayProceduralValidation.test.js`
  - `tests/tx30StakeRelayFraud.integration.test.js`

## Example Flow (Scenario)
1. Activate tx30.
2. Create collateral token (tLTC/property `1`) and procedural receipt token.
3. Create oracle + DLC template/contract records.
4. Stake oracle in property `1`.
5. Multiple depositors commit collateral to vault and receive receipt token.
6. Trade receipt token between users.
7. Submit valid signed relay; transition to settlement and auto-roll next contract.
8. Submit invalid relay; detect and reject.
9. Submit fraud proof; slash bad staker and reward challenger.
10. Sweep profits (trusted path) and process user redemption.

## Next Work Needed For Full DLC UTXO Path
- Wire UTXO-ref funding/CET/refund transaction generation into this flow.
- Bind `dlcTemplateId/dlcContractId` to concrete UTXO outpoints + script descriptors.
- Move from ledger-only deposit/settle simulation to chain-verified spends.

