const BinohashAdapter = require('../src/experimental/binohash/binohashAdapter');

describe('experimental binohash adapter', () => {
  test('builds and verifies a valid proof', () => {
    const transitions = [
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64)
    ];
    const built = BinohashAdapter.buildProofFromTransitionHashes(transitions, 1);
    expect(built.root).toMatch(/^[0-9a-f]{64}$/);
    const out = BinohashAdapter.verifyProof({
      transitionHash: transitions[1],
      root: built.root,
      proof: built.proof
    });
    expect(out.valid).toBe(true);
  });

  test('rejects invalid proof data', () => {
    const out = BinohashAdapter.verifyProof({
      transitionHash: 'd'.repeat(64),
      root: 'e'.repeat(64),
      proof: [{ side: 'R', hash: 'ff' }]
    });
    expect(out.valid).toBe(false);
  });
});

