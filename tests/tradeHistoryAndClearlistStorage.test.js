function loadTradeHistoryWithRows(rows) {
  jest.resetModules();
  jest.doMock('../src/db.js', () => ({
    getDatabase: jest.fn(async () => ({
      findAsync: jest.fn(async () => rows),
    })),
  }));
  return require('../src/tradeHistoryManager.js');
}

function makeAttestationDatabase() {
  const documents = new Map();
  const matchesList = (doc, clearlistId) =>
    doc.data.listId === clearlistId || doc.data.clearlistId === clearlistId;

  return {
    documents,
    findOneAsync: jest.fn(async query => {
      return [...documents.values()].find(doc =>
        doc.data.address === query['data.address'] &&
        query.$or.some(condition => matchesList(doc, condition['data.listId'] ?? condition['data.clearlistId']))
      ) || null;
    }),
    findAsync: jest.fn(async query => {
      if (!query || !query.$or) return [...documents.values()];
      return [...documents.values()].filter(doc => query.$or.some(condition =>
        matchesList(doc, condition['data.listId'] ?? condition['data.clearlistId'])
      ));
    }),
    updateAsync: jest.fn(async (query, update) => {
      const existing = documents.get(query._id) || { _id: query._id };
      documents.set(query._id, { ...existing, ...update.$set });
    }),
  };
}

describe('trade history and clearlist storage', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('../src/db.js');
  });

  test('getTradeHistoryForAddress keeps an optional contract filter for static and instance callers', async () => {
    const address = 'TLAddress';
    const TradeHistory = loadTradeHistoryWithRows([
      {
        _id: 'contract-7-a',
        key: 'contract-7',
        blockHeight: 20,
        trade: { contractId: 7, buyerAddress: address, marker: 'matching-contract' },
      },
      {
        _id: 'contract-8-a',
        key: 'contract-8',
        blockHeight: 10,
        trade: { contractId: 8, sellerAddress: address.toLowerCase(), marker: 'other-contract' },
      },
      {
        _id: 'contract-7-b',
        key: 'contract-7',
        blockHeight: 30,
        trade: { contractId: 7, buyerAddress: 'another-address', marker: 'other-address' },
      },
    ]);

    const expected = [{ contractId: 7, buyerAddress: address, marker: 'matching-contract' }];
    await expect(TradeHistory.getTradeHistoryForAddress(address, 7)).resolves.toEqual(expected);
    await expect(new TradeHistory().getTradeHistoryForAddress(address, 7)).resolves.toEqual(expected);
  });

  test('stores separate attestations when one address belongs to two clearlists', async () => {
    const attestations = makeAttestationDatabase();
    attestations.documents.set('TLAddress', {
      _id: 'TLAddress',
      data: { listId: '1', address: 'TLAddress', status: 'active', data: 'US', timestamp: 99 },
    });
    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async () => attestations),
    }));
    const Clearlist = require('../src/clearlist.js');

    const firstId = await Clearlist.addAttestation(1, 'TLAddress', 'CA', 100);
    const secondId = await Clearlist.addAttestationWithXpub(2, 'TLAddress', 'xpub:example', 'example', 101);

    expect(firstId).toBe('TLAddress');
    expect(secondId).toBe('attestation:2:TLAddress');
    expect([...attestations.documents.values()].map(doc => doc.data)).toEqual([
      expect.objectContaining({ listId: 1, address: 'TLAddress', data: 'CA' }),
      expect.objectContaining({ listId: 2, address: 'TLAddress', data: 'xpub:example', xpub: 'example' }),
    ]);
    await expect(Clearlist.isAddressInClearlist(1, 'TLAddress')).resolves.toBe(true);
    await expect(Clearlist.isAddressInClearlist(2, 'TLAddress')).resolves.toBe(true);
  });
});
