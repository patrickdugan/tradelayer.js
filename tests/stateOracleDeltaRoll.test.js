describe('state oracle delta and roll payloads', () => {
  function loadHarness() {
    jest.resetModules();

    const rows = [
      { data: { address: 'a1', property: 380, block: 100, avail: 5, res: 0, mar: 0, vest: 0, channel: 0, total: 5, type: 'issuance', tx: 'tx1' } },
      { data: { address: 'a1', property: 380, block: 101, avail: -2, res: 0, mar: 0, vest: 0, channel: 0, total: 3, type: 'send', tx: 'tx2' } },
      { data: { address: 'a1', property: 380, block: 102, avail: -1, res: 0, mar: 0, vest: 0, channel: 0, total: 2, type: 'redeemManagedToken', tx: 'tx3' } },
      { data: { address: 'a1', property: 380, block: 103, avail: 1, res: 0, mar: 0, vest: 0, channel: 0, total: 3, type: 'optionPremiumReceive', tx: 'tx4' } },
      { data: { address: 'a1', property: 380, block: 104, avail: -1, res: 0, mar: 0, vest: 0, channel: 0, total: 2, type: 'optionPremiumPay', tx: 'tx5' } },
      { data: { address: 'a1', property: 380, block: 105, avail: 0, res: 0, mar: 0, vest: 0, channel: 0, total: 2, type: 'clearing', tx: 'tx6' } },
      { data: { address: 'a2', property: 380, block: 101, avail: 0, res: 0, mar: 0, vest: 0, channel: 0, total: 0, type: 'clearing', tx: 'tx7' } }
    ];

    jest.doMock('../src/db.js', () => ({
      getDatabase: async () => ({
        findAsync: async () => rows
      })
    }));
    jest.doMock('../src/tally.js', () => ({
      getTally: jest.fn(async () => ({ available: 9, reserved: 1, margin: 0, vesting: 0, channelBalance: 0 })),
      loadFromDB: jest.fn(async () => {}),
      addresses: new Map([
        ['a1', { 380: { available: 9, reserved: 1, margin: 0, vesting: 0, channelBalance: 0 } }]
      ])
    }));

    return require('../src/stateOracle.js');
  }

  test('delta payload classifies ops and ignores clearing', async () => {
    const stateOracle = loadHarness();
    const payload = await stateOracle.buildAddressDeltaPayload({
      propertyId: 380,
      addresses: ['a1'],
      fromBlock: 100,
      toBlock: 105
    });

    expect(payload.kind).toBe('delta');
    expect(payload.rowCount).toBe(5);
    expect(payload.rows.map((r) => r.op)).toEqual(['issue', 'send', 'redeem', 'rpnl', 'rpnl']);
    expect(payload.rows.some((r) => r.type === 'clearing')).toBe(false);
  });

  test('roll payload uses t-1 snapshot block', async () => {
    const stateOracle = loadHarness();
    const payload = await stateOracle.buildAddressRollPayload({
      propertyId: 380,
      addresses: ['a1'],
      rollHeight: 200,
      fromBlock: 150
    });

    expect(payload.kind).toBe('roll');
    expect(payload.snapshotBlock).toBe(199);
    expect(payload.deltaWindow.toBlock).toBe(199);
    expect(payload.snapshot.propertyId).toBe(380);
  });

  test('daily payload omits no-op addresses and keeps metadata', async () => {
    const stateOracle = loadHarness();
    const payload = await stateOracle.buildAddressDailyPayload({
      propertyId: 380,
      addresses: ['a1', 'a2'],
      fromBlock: 100,
      toBlock: 105
    });

    expect(payload.kind).toBe('daily');
    expect(payload.rowCount).toBe(1);
    expect(payload.omittedAddressCount).toBe(1);
    expect(payload.rows[0]).toEqual(expect.objectContaining({
      address: 'a1',
      defaultRoll: false,
      changeCount: 5,
      opSummary: expect.objectContaining({
        issue: 1,
        send: 1,
        redeem: 1,
        rpnl: 2
      })
    }));
  });

  test('daily payload can include no-op addresses when omission is disabled', async () => {
    const stateOracle = loadHarness();
    const payload = await stateOracle.buildAddressDailyPayload({
      propertyId: 380,
      addresses: ['a1', 'a2'],
      fromBlock: 100,
      toBlock: 105,
      omitNoOpAddresses: false
    });

    expect(payload.rowCount).toBe(2);
    expect(payload.rows.find((r) => r.address === 'a2')).toEqual(expect.objectContaining({
      defaultRoll: true,
      changeCount: 0
    }));
  });
});
