const fs = require('fs');
const path = require('path');

describe('Options feature wiring', () => {
  test('decodeOptionTrade preserves contractId', () => {
    const Encode = require('../src/txEncoder');
    const Decode = require('../src/txDecoder');

    const encoded = Encode.encodeOptionTrade({
      contractId: '3-1000-C-150',
      price: 1.25,
      amount: 4,
      columnAIsSeller: true,
      expiryBlock: 1200,
      columnAIsMaker: false
    });

    const decoded = Decode.decodeOptionTrade(encoded.slice(3));
    expect(decoded.contractId).toBe('3-1000-C-150');
    expect(decoded.ticker).toBe('3-1000-C-150');
    expect(decoded.amount).toBe(4);
    expect(decoded.columnAIsSeller).toBe(true);
    expect(decoded.columnAIsMaker).toBe(false);
  });

  test('type 27 decode forwards blockHeight into validation', async () => {
    jest.resetModules();
    const validateOptionTrade = jest.fn(async (_sender, params) => params);

    jest.doMock('../src/txDecoder', () => ({
      decodeOptionTrade: jest.fn(() => ({
        ticker: '3-1000-C-150',
        price: 2,
        amount: 1,
        columnAIsSeller: true,
        expiryBlock: 2000
      }))
    }));

    jest.doMock('../src/validity', () => ({
      validateOptionTrade
    }));

    jest.doMock('../src/txEncoder', () => ({}));
    jest.doMock('../src/txUtils', () => ({}));
    jest.doMock('../src/txIndex.js', () => ({}));

    const Types = require('../src/types');
    const out = await Types.decodePayload(
      'tx-1',
      27,
      'tl',
      'payload-does-not-matter',
      'sender-channel',
      null,
      null,
      null,
      777777
    );

    expect(validateOptionTrade).toHaveBeenCalledTimes(1);
    expect(out.blockHeight).toBe(777777);
    expect(out.block).toBe(777777);
    expect(out.senderAddress).toBe('sender-channel');
  });

  test('logic typeSwitch routes tx 27 to Logic.processOptionTrade', () => {
    const logicSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'logic.js'), 'utf8');
    expect(logicSource).toMatch(/case 27:\s*[\s\S]*Logic\.processOptionTrade\(params\.senderAddress,\s*params,\s*params\.txid\)/m);
  });

  test('naked maintenance uses 10 percent rule', () => {
    const Options = require('../src/options');
    expect(Options.nakedMaintenance('Call', 120, 150).toNumber()).toBe(15);
    expect(Options.nakedMaintenance('Put', 120, 150).toNumber()).toBe(12);
  });
});
