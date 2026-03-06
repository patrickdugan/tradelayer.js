const assert = require('assert');
const Encode = require('../src/txEncoder');
const Decode = require('../src/txDecoder');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randBool() {
  return Math.random() < 0.5;
}

function randPrice() {
  const whole = randInt(1, 500000);
  const frac = randInt(0, 99999999) / 1e8;
  return Number((whole + frac).toFixed(8));
}

function assertClose(a, b, eps = 1e-8) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ~= ${b}`);
}

function runOne(i) {
  const params = {
    contractId: randInt(1, 5000),
    price: randPrice(),
    amount: randInt(1, 1000),
    columnAIsSeller: randBool(),
    expiryBlock: randInt(3000000, 6000000),
    insurance: randBool(),
    columnAIsMaker: randBool()
  };

  const encoded = Encode.encodeTradeContractChannel(params);
  assert.ok(encoded.startsWith('tlj'), `case ${i}: bad marker/type: ${encoded}`);

  // decoder expects body only, not marker+type
  const decoded = Decode.decodeTradeContractChannel(encoded.slice(3));

  assert.strictEqual(decoded.contractId, params.contractId, `case ${i}: contractId mismatch`);
  assertClose(decoded.price, params.price, 1e-8);
  assert.strictEqual(decoded.amount, params.amount, `case ${i}: amount mismatch`);
  assert.strictEqual(decoded.columnAIsSeller, params.columnAIsSeller, `case ${i}: side mismatch`);
  assert.strictEqual(decoded.expiryBlock, params.expiryBlock, `case ${i}: expiry mismatch`);
  assert.strictEqual(decoded.insurance, params.insurance, `case ${i}: insurance mismatch`);
  assert.strictEqual(decoded.columnAIsMaker, params.columnAIsMaker, `case ${i}: maker mismatch`);
}

function runBoundaries() {
  const boundaries = [
    {
      contractId: 1,
      price: 0.00000001,
      amount: 1,
      columnAIsSeller: false,
      expiryBlock: 3082500,
      insurance: false,
      columnAIsMaker: false
    },
    {
      contractId: 999999,
      price: 999999999.99999999,
      amount: 1000000,
      columnAIsSeller: true,
      expiryBlock: 9999999,
      insurance: true,
      columnAIsMaker: true
    }
  ];

  boundaries.forEach((params, i) => {
    const encoded = Encode.encodeTradeContractChannel(params);
    const decoded = Decode.decodeTradeContractChannel(encoded.slice(3));
    assert.strictEqual(decoded.contractId, params.contractId, `boundary ${i} contractId`);
    assertClose(decoded.price, params.price, 1e-8);
    assert.strictEqual(decoded.amount, params.amount, `boundary ${i} amount`);
  });
}

function main() {
  runBoundaries();
  for (let i = 0; i < 500; i++) {
    runOne(i);
  }
  console.log('PASS channelContractTrade fuzz: 500 random + boundary vectors');
}

main();
