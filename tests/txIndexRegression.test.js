describe('TxIndex regression coverage', () => {
  function loadTxIndexWithDb(dbMock) {
    jest.resetModules();
    jest.doMock('../src/db.js', () => dbMock);
    jest.doMock('../src/txUtils', () => ({
      getSender: jest.fn(),
      getTransactionOutputs: jest.fn()
    }));
    return require('../src/txIndex.js');
  }

  test('initializeIndex inserts genesisBlock when absent', async () => {
    const base = {
      findOneAsync: jest.fn().mockResolvedValue(null),
      insertAsync: jest.fn().mockResolvedValue({ ok: true })
    };
    const dbMock = { getDatabase: jest.fn().mockResolvedValue(base) };
    const TxIndex = loadTxIndexWithDb(dbMock);

    await expect(TxIndex.initializeIndex(3082500)).resolves.toBeUndefined();
    expect(base.insertAsync).toHaveBeenCalledWith({ _id: 'genesisBlock', value: 3082500 });
  });

  test('DecodeRawTransaction parses marker correctly with PUSHDATA1 prefix', async () => {
    const dbMock = { getDatabase: jest.fn() };
    const TxIndex = loadTxIndexWithDb(dbMock);
    TxIndex.client = {
      decoderawtransaction: jest.fn().mockResolvedValue({
        vout: [{ scriptPubKey: { type: 'nulldata', hex: '6a4c04746c6162' } }]
      })
    };

    const out = await TxIndex.DecodeRawTransaction('deadbeef');
    expect(out).toBeTruthy();
    expect(out.marker).toBe('tl');
    expect(out.payload).toBe('ab');
  });

  test('getTransactionData resolves by tx suffix document id', async () => {
    const base = {
      findOneAsync: jest.fn().mockResolvedValue({ value: { txId: 'abc123', valid: true } })
    };
    const dbMock = { getDatabase: jest.fn().mockResolvedValue(base) };
    const TxIndex = loadTxIndexWithDb(dbMock);

    const out = await TxIndex.getTransactionData('abc123');
    expect(out).toEqual({ txId: 'abc123', valid: true });
    expect(base.findOneAsync).toHaveBeenCalled();
  });
});
