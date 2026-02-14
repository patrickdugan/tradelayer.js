jest.mock("../src/db.js", () => ({
  getDatabase: jest.fn(async () => ({
    findOneAsync: async () => null,
    findAsync: async () => [],
    updateAsync: async () => 1,
  })),
}));
jest.mock("../src/contractRegistry.js", () => ({}));

const VolumeIndex = require("../src/volumeIndex.js");

describe("VolumeIndex liquidity reward attenuation", () => {
  test("reward share attenuates as cumulative LTC volume grows", () => {
    const low = VolumeIndex.computeLiquidityRewardShare(100, {
      maxShare: 0.35,
      minShare: 0.02,
      pivotLtc: 1000,
      slope: 1,
    });
    const high = VolumeIndex.computeLiquidityRewardShare(10000000, {
      maxShare: 0.35,
      minShare: 0.02,
      pivotLtc: 1000,
      slope: 1,
    });

    expect(low).toBeGreaterThan(high);
    expect(low).toBeLessThanOrEqual(0.35);
    expect(high).toBeGreaterThanOrEqual(0.02);
  });

  test("attenuated reward stays below paid fee when maxShare < 1", () => {
    const feePaid = 0.5;
    const reward = VolumeIndex.calculateAttenuatedLiquidityReward(feePaid, 500000, {
      maxShare: 0.35,
      minShare: 0.02,
      pivotLtc: 1000,
      slope: 1,
    });

    expect(reward).toBeGreaterThanOrEqual(0);
    expect(reward).toBeLessThan(feePaid);
  });
});
