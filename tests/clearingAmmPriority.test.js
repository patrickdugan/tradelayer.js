function loadClearing() {
  jest.resetModules();
  jest.doMock('../src/tally.js', () => ({}));
  jest.doMock('../src/contractRegistry.js', () => ({}));
  jest.doMock('../src/db.js', () => ({}));
  jest.doMock('../src/options.js', () => ({}));
  jest.doMock('../src/marginMap.js', () => ({}));
  jest.doMock('../src/insurance.js', () => ({}));
  jest.doMock('../src/orderbook.js', () => ({}));
  jest.doMock('../src/channels.js', () => ({}));
  jest.doMock('../src/property.js', () => ({}));
  jest.doMock('../src/volumeIndex.js', () => ({}));
  jest.doMock('../src/oracle.js', () => ({}));
  jest.doMock('../src/iou.js', () => ({}));
  jest.doMock('../src/tradeHistoryManager.js', () => ({}));
  return require('../src/clearing');
}

describe('Clearing AMM-first liquidation sweep', () => {
  test('prioritizes AMM levels over non-AMM for liquidation sell', () => {
    const Clearing = loadClearing();
    const ob = {
      buy: [
        { sender: 'traderA', amount: 5, price: 105, blockTime: 10, txid: 'tA' },
        { sender: 'amm', amount: 2, price: 101, blockTime: 11, txid: 'amm-1' },
        { sender: 'amm', amount: 3, price: 100, blockTime: 12, txid: 'amm-2' }
      ],
      sell: []
    };

    const liqOrder = {
      address: 'liqAddr',
      contractId: 3,
      sell: true,
      isLiq: true,
      txid: 'liq-tx'
    };

    const out = Clearing._sweepAmmLiquidityFirst(ob, liqOrder, 4, 99, false);

    expect(out.filledSize).toBe(4);
    expect(out.matches).toHaveLength(2);
    expect(out.matches[0].buyOrder.sender).toBe('amm');
    expect(out.matches[1].buyOrder.sender).toBe('amm');
    expect(ob.buy.find(o => o.sender === 'traderA').amount).toBe(5);
  });

  test('respects liquidation safety boundary', () => {
    const Clearing = loadClearing();
    const ob = {
      buy: [
        { sender: 'amm', amount: 2, price: 98, blockTime: 10, txid: 'amm-bad' },
        { sender: 'amm', amount: 2, price: 101, blockTime: 11, txid: 'amm-good' }
      ],
      sell: []
    };

    const liqOrder = {
      address: 'liqAddr',
      contractId: 3,
      sell: true,
      isLiq: true,
      txid: 'liq-tx'
    };

    const out = Clearing._sweepAmmLiquidityFirst(ob, liqOrder, 4, 100, false);

    expect(out.filledSize).toBe(2);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].buyOrder.txid).toBe('amm-good');
  });

  test('handles decimal fills without floating drift', () => {
    const Clearing = loadClearing();
    const ob = {
      buy: [
        { sender: 'amm', amount: 0.1, price: 101, blockTime: 10, txid: 'amm-a' },
        { sender: 'amm', amount: 0.2, price: 100, blockTime: 11, txid: 'amm-b' }
      ],
      sell: []
    };

    const liqOrder = {
      address: 'liqAddr',
      contractId: 3,
      sell: true,
      isLiq: true,
      txid: 'liq-tx'
    };

    const out = Clearing._sweepAmmLiquidityFirst(ob, liqOrder, 0.3, 99, false);
    expect(out.filledSize).toBe(0.3);
    expect(out.matches).toHaveLength(2);
  });
});
