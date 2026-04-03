const crypto = require('crypto');
const TallyMap = require('./tally.js');
const dbInstance = require('./db.js');

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function quantize8(value) {
  const n = Number(value || 0);
  return Math.floor(n * 1e8) / 1e8;
}

function bucketize(balance, bucketSize) {
  const bal = quantize8(balance);
  const step = Math.max(quantize8(bucketSize), 0.00000001);
  const bucketMin = Math.floor(bal / step) * step;
  const bucketMax = bucketMin + step;
  return {
    bucketMin: quantize8(bucketMin),
    bucketMax: quantize8(bucketMax)
  };
}

function normalizeType(type) {
  return String(type || '').trim().toLowerCase();
}

function classifyDeltaOp(delta) {
  const type = normalizeType(delta?.type);
  if (!type) return null;
  if (type.includes('clear') || type.includes('clearing')) return null;
  if (type.includes('issu') || type.includes('mint') || type.includes('grant')) return 'issue';
  if (type.includes('redeem') || type.includes('burn') || type.includes('destroy')) return 'redeem';
  if (type.includes('send') || type.includes('transfer') || type.includes('withdraw') || type.includes('vestingsend')) return 'send';
  if (
    type.includes('rpnl') ||
    type.includes('pnl') ||
    type.includes('margintransition') ||
    type.includes('optionpremium') ||
    type.includes('optionreducebuyer') ||
    type.includes('oraclepnl')
  ) {
    return 'rpnl';
  }
  return null;
}

function netDeltaForRow(delta) {
  return Number(delta.avail || 0)
    + Number(delta.res || 0)
    + Number(delta.mar || 0)
    + Number(delta.vest || 0)
    + Number(delta.channel || 0);
}

function summarizeOps(rows) {
  const summary = {
    issue: 0,
    send: 0,
    redeem: 0,
    rpnl: 0
  };
  for (const row of rows || []) {
    const op = classifyDeltaOp(row);
    if (op && Object.prototype.hasOwnProperty.call(summary, op)) {
      summary[op] += 1;
    }
  }
  return summary;
}

async function buildAddressBalancePayload({ propertyId, addresses, bucketSize = 1 }) {
  const rows = [];
  for (const address of addresses || []) {
    const tally = await TallyMap.getTally(address, propertyId);
    const available = quantize8(Number(tally?.available || 0));
    const bucket = bucketize(available, bucketSize);
    rows.push({
      address: String(address),
      available,
      bucketMin: bucket.bucketMin,
      bucketMax: bucket.bucketMax
    });
  }
  rows.sort((a, b) => a.address.localeCompare(b.address));
  return {
    schema: 'tl-state-oracle-balance-v1',
    propertyId: Number(propertyId),
    bucketSize: quantize8(bucketSize),
    rows
  };
}

async function buildAddressDeltaPayload({
  propertyId,
  addresses = [],
  fromBlock = 0,
  toBlock = Number.MAX_SAFE_INTEGER,
  includeZero = false,
  includeOps = ['issue', 'send', 'redeem', 'rpnl']
}) {
  const deltaDB = await dbInstance.getDatabase('tallyMapDelta');
  const query = {
    'data.property': Number(propertyId),
    'data.block': { $gte: Number(fromBlock || 0), $lte: Number(toBlock || Number.MAX_SAFE_INTEGER) }
  };
  if (Array.isArray(addresses) && addresses.length > 0) {
    query['data.address'] = { $in: addresses.map((a) => String(a)) };
  }
  const rows = await deltaDB.findAsync(query);
  const normalized = rows
    .map((row) => row?.data || row || {})
    .map((delta) => {
      const op = classifyDeltaOp(delta);
      const netChange = netDeltaForRow(delta);
      const direction = op === 'issue'
        ? 'positive'
        : op === 'redeem'
          ? 'negative'
          : op === 'send'
            ? (netChange >= 0 ? 'positive' : 'negative')
            : netChange > 0
              ? 'positive'
              : netChange < 0
                ? 'negative'
                : 'neutral';
      return {
        address: String(delta.address || ''),
        propertyId: Number(delta.property || delta.propertyId || propertyId),
        block: Number(delta.block || 0),
        avail: Number(delta.avail || 0),
        res: Number(delta.res || 0),
        mar: Number(delta.mar || 0),
        vest: Number(delta.vest || 0),
        channel: Number(delta.channel || 0),
        total: Number(delta.total || 0),
        type: String(delta.type || ''),
        op,
        direction,
        netChange,
        tx: String(delta.tx || '')
      };
    })
    .filter((delta) => {
      if (!delta.address) return false;
      if (!delta.op || !includeOps.includes(delta.op)) return false;
      return includeZero || delta.avail || delta.res || delta.mar || delta.vest || delta.channel || delta.netChange;
    });
  normalized.sort((a, b) => {
    const blockDiff = a.block - b.block;
    if (blockDiff !== 0) return blockDiff;
    const addrDiff = a.address.localeCompare(b.address);
    if (addrDiff !== 0) return addrDiff;
    return a.tx.localeCompare(b.tx);
  });

  return {
    schema: 'tl-state-oracle-delta-v1',
    kind: 'delta',
    propertyId: Number(propertyId),
    fromBlock: Number(fromBlock || 0),
    toBlock: Number(toBlock || Number.MAX_SAFE_INTEGER),
    rowCount: normalized.length,
    rows: normalized
  };
}

async function buildAddressDailyPayload({
  propertyId,
  addresses = [],
  fromBlock = 0,
  toBlock = Number.MAX_SAFE_INTEGER,
  bucketSize = 1,
  includeZero = false,
  omitNoOpAddresses = true,
  includeOps = ['issue', 'send', 'redeem', 'rpnl']
}) {
  const deltaDB = await dbInstance.getDatabase('tallyMapDelta');
  const query = {
    'data.property': Number(propertyId),
    'data.block': { $gte: Number(fromBlock || 0), $lte: Number(toBlock || Number.MAX_SAFE_INTEGER) }
  };
  if (Array.isArray(addresses) && addresses.length > 0) {
    query['data.address'] = { $in: addresses.map((a) => String(a)) };
  }
  const rows = await deltaDB.findAsync(query);
  const byAddress = new Map();
  for (const row of rows || []) {
    const delta = row?.data || row || {};
    const op = classifyDeltaOp(delta);
    if (!op || !includeOps.includes(op)) continue;
    const address = String(delta.address || '');
    if (!address) continue;
    const current = byAddress.get(address) || [];
    current.push({
      address,
      propertyId: Number(delta.property || delta.propertyId || propertyId),
      block: Number(delta.block || 0),
      avail: Number(delta.avail || 0),
      res: Number(delta.res || 0),
      mar: Number(delta.mar || 0),
      vest: Number(delta.vest || 0),
      channel: Number(delta.channel || 0),
      total: Number(delta.total || 0),
      type: String(delta.type || ''),
      op,
      direction: netDeltaForRow(delta) >= 0 ? 'positive' : 'negative',
      netChange: netDeltaForRow(delta),
      tx: String(delta.tx || '')
    });
    byAddress.set(address, current);
  }

  const requestedAddresses = Array.isArray(addresses) && addresses.length > 0
    ? addresses.map((a) => String(a))
    : Array.from(byAddress.keys());
  const normalized = [];
  for (const address of requestedAddresses.sort((a, b) => a.localeCompare(b))) {
    const changes = byAddress.get(address) || [];
    const opSummary = summarizeOps(changes);
    const hasChanges = changes.length > 0;
    if (omitNoOpAddresses && !hasChanges) {
      continue;
    }
    const currentTally = await TallyMap.getTally(address, propertyId);
    const available = quantize8(Number(currentTally?.available || 0));
    const reserved = quantize8(Number(currentTally?.reserved || 0));
    const margin = quantize8(Number(currentTally?.margin || 0));
    const vesting = quantize8(Number(currentTally?.vesting || 0));
    const channelBalance = quantize8(Number(currentTally?.channelBalance || 0));
    const bucket = bucketize(available, bucketSize);
    normalized.push({
      address,
      propertyId: Number(propertyId),
      available,
      reserved,
      margin,
      vesting,
      channelBalance,
      bucketMin: bucket.bucketMin,
      bucketMax: bucket.bucketMax,
      defaultRoll: !hasChanges,
      changeCount: changes.length,
      lastBlock: changes.reduce((max, row) => Math.max(max, Number(row.block || 0)), 0),
      lastTx: changes.reduce((acc, row) => (Number(row.block || 0) >= Number(acc.block || 0) ? row : acc), { block: 0, tx: '' }).tx || '',
      opSummary,
      changes
    });
  }

  normalized.sort((a, b) => a.address.localeCompare(b.address));

  return {
    schema: 'tl-state-oracle-daily-v1',
    kind: 'daily',
    propertyId: Number(propertyId),
    windowStartBlock: Number(fromBlock || 0),
    windowEndBlock: Number(toBlock || Number.MAX_SAFE_INTEGER),
    bucketSize: quantize8(bucketSize),
    rowCount: normalized.length,
    omittedAddressCount: Array.isArray(addresses) ? Math.max(0, addresses.length - normalized.length) : 0,
    rows: normalized
  };
}

async function buildAddressRollPayload({
  propertyId,
  addresses = [],
  rollHeight,
  fromBlock = 0,
  bucketSize = 1,
  includeZero = false,
  includeOps = ['issue', 'send', 'redeem', 'rpnl']
}) {
  const snapshotBlock = Number.isFinite(Number(rollHeight))
    ? Math.max(0, Number(rollHeight) - 1)
    : Number.MAX_SAFE_INTEGER;
  const snapshot = await buildAddressBalancePayload({ propertyId, addresses, bucketSize });
  const deltaWindow = await buildAddressDeltaPayload({
    propertyId,
    addresses,
    fromBlock,
    toBlock: snapshotBlock,
    includeZero,
    includeOps
  });

  return {
    schema: 'tl-state-oracle-roll-v1',
    kind: 'roll',
    propertyId: Number(propertyId),
    rollHeight: Number(rollHeight || 0),
    snapshotBlock,
    fromBlock: Number(fromBlock || 0),
    snapshot,
    deltaWindow,
    digestSource: {
      snapshotBlock,
      deltaWindowRowCount: deltaWindow.rowCount
    }
  };
}

function encodeBalancePayload(payload) {
  const canonical = JSON.stringify(payload || {});
  return Buffer.from(canonical, 'utf8').toString('base64');
}

function payloadHashFromB64(balancePayloadB64) {
  return sha256Hex(Buffer.from(balancePayloadB64, 'base64'));
}

module.exports = {
  buildAddressBalancePayload,
  buildAddressDeltaPayload,
  buildAddressDailyPayload,
  buildAddressRollPayload,
  encodeBalancePayload,
  payloadHashFromB64
};
