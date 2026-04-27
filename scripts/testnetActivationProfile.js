const crypto = require('crypto');

const ACTIVATION_PROFILE_ID = 'bitvm-ln-tlusd-tx33';
const DEFAULT_BTCTEST_ADMIN_ADDRESS = 'tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu';

const activationGroups = [
  {
    id: 'core-ledger',
    purpose: 'Base token accounting and channel funding surface.',
    txTypes: [0, 1, 2, 4]
  },
  {
    id: 'managed-receipts',
    purpose: 'DLC/BitVM receipt token mint and redemption paths.',
    txTypes: [11, 12]
  },
  {
    id: 'oracle-and-perp',
    purpose: 'BTC/USD oracle, perp series, on-chain and channel contract trades.',
    txTypes: [13, 14, 16, 18, 19, 27]
  },
  {
    id: 'channel-routing',
    purpose: 'LN-facing channel token flow, withdrawal, transfer, PNL settlement, and pay-to-token routing.',
    txTypes: [20, 21, 22, 23, 26, 31]
  },
  {
    id: 'synthetic-usd',
    purpose: 'Mint and redeem TL synthetic USD against BTC/USD perp collateral.',
    txTypes: [24, 25]
  },
  {
    id: 'bitvm-enforcement',
    purpose: 'Oracle stake, relay, fraud proof, and BitVM/DLC challenge evidence.',
    txTypes: [30]
  },
  {
    id: 'externalization',
    purpose: 'Export TL synthetic USD into colored/TAP-style commitments and bridge metadata.',
    txTypes: [33, 34]
  }
];

const txNames = {
  0: 'Activate TradeLayer',
  1: 'Token Issue',
  2: 'Send',
  4: 'Commit Token',
  11: 'Grant Managed Token',
  12: 'Redeem Managed Token',
  13: 'Create Oracle',
  14: 'Publish Oracle Data',
  16: 'Create Future Contract Series',
  18: 'Trade Contract On-chain',
  19: 'Trade Contract Channel',
  20: 'Trade Tokens Channel',
  21: 'Withdrawal',
  22: 'Transfer',
  23: 'Settle Channel PNL',
  24: 'Mint Synthetic',
  25: 'Redeem Synthetic',
  26: 'Pay to Tokens',
  27: 'Create Option Chain',
  30: 'Oracle Stake/Fraud/Relay',
  31: 'Batch Move Zk Rollup',
  33: 'Colored Coin',
  34: 'Cross Layer Bridge'
};

function uniqueTxTypes(groups = activationGroups) {
  return [...new Set(groups.flatMap((group) => group.txTypes))].sort((a, b) => a - b);
}

function defaultCodeHash() {
  const seed = [
    ACTIVATION_PROFILE_ID,
    'tradelayer.js',
    'ln-btc-tlusd-bitvm-liquidity',
    uniqueTxTypes().join(',')
  ].join('|');
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function buildActivationManifest(options = {}) {
  const network = options.network || 'BTCTEST';
  const activationBlock = Number(options.activationBlock || 1);
  const codeHash = options.codeHash || defaultCodeHash();
  const adminAddress = options.adminAddress || process.env.TL_ADMIN_ADDRESS || (
    String(network).toUpperCase() === 'BTCTEST' ? DEFAULT_BTCTEST_ADMIN_ADDRESS : ''
  );
  const txTypes = uniqueTxTypes();
  return {
    kind: 'tradelayer_testnet_activation_manifest',
    profileId: ACTIVATION_PROFILE_ID,
    network,
    adminAddress,
    activationBlock,
    codeHash,
    txTypes,
    groups: activationGroups.map((group) => ({
      ...group,
      txTypes: group.txTypes.map((txType) => ({
        txType,
        name: txNames[txType] || `Tx ${txType}`
      }))
    })),
    setupPlan: [
      'Activate core accounting, channel, oracle, derivative, synthetic, fraud, and tx33 wrapper tx types.',
      'Initialize native collateral through tx0 before issuing demo TLUSD or receipt properties.',
      'Create BTCUSD state/price oracles with tx13 and publish price/state marks with tx14.',
      'Create a BTCUSD perp series with tx16, then use tx19/tx27 for channel perp/option exposure.',
      'Mint or redeem TL synthetic USD with tx24/tx25 once collateral and marks are available.',
      'Use tx30 for BitVM/DLC relay, stake, and fraud evidence.',
      'Use tx33 to externalize TL synthetic USD into TAP/colored-UTXO commitment metadata.'
    ]
  };
}

function registryFromManifest(manifest) {
  const registry = {};
  for (const [key, name] of Object.entries(txNames)) {
    registry[key] = { name, active: false };
  }
  for (const txType of manifest.txTypes) {
    registry[txType] = {
      ...(registry[txType] || { name: txNames[txType] || `Tx ${txType}` }),
      active: true,
      activationBlock: manifest.activationBlock,
      codeHash: manifest.codeHash,
      profileId: manifest.profileId,
      network: manifest.network
    };
  }
  return registry;
}

module.exports = {
  ACTIVATION_PROFILE_ID,
  DEFAULT_BTCTEST_ADMIN_ADDRESS,
  activationGroups,
  txNames,
  uniqueTxTypes,
  defaultCodeHash,
  buildActivationManifest,
  registryFromManifest
};
