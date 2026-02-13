function createHarness(options = {}) {
  const {
    isNativeContract = false,
    feeCacheBuyHasSell = false,
    feeCacheBuyMatches = true,
  } = options;

  jest.resetModules();

  const feeRows = new Map();
  const dustRows = new Map();
  const insuranceDeposits = [];

  const feeDb = {
    findOneAsync: jest.fn(async (query) => {
      const key = query && query._id;
      return feeRows.has(key) ? { _id: key, ...feeRows.get(key) } : null;
    }),
    updateAsync: jest.fn(async (query, update) => {
      const key = query && query._id;
      const prev = feeRows.get(key) || {};
      const next = { ...prev, ...(update && update.$set ? update.$set : {}) };
      feeRows.set(key, next);
      return 1;
    }),
    get: jest.fn(async (key) => {
      if (!dustRows.has(key)) throw new Error("not found");
      return dustRows.get(key);
    }),
    put: jest.fn(async (key, value) => {
      dustRows.set(key, value);
      return true;
    }),
    findAsync: jest.fn(async () =>
      Array.from(feeRows.entries()).map(([key, value]) => ({ _id: key, ...value }))
    ),
  };

  const consensusDb = {
    findOneAsync: jest.fn(async () => null),
  };

  const tallyDb = {
    findOneAsync: jest.fn(async () => null),
    updateAsync: jest.fn(async () => 1),
  };

  const dbMock = {
    getDatabase: jest.fn(async (name) => {
      if (name === "feeCache") return feeDb;
      if (name === "consensus") return consensusDb;
      if (name === "tallyMap") return tallyDb;
      return {
        findOneAsync: async () => null,
        updateAsync: async () => 1,
        findAsync: async () => [],
        get: async () => {
          throw new Error("not found");
        },
        put: async () => true,
      };
    }),
  };

  const propertyMock = {
    getPropertyData: jest.fn(async () => ({ totalInCirculation: 100 })),
  };

  const insuranceInstance = {
    deposit: jest.fn(async (...args) => {
      insuranceDeposits.push(args);
      return true;
    }),
  };

  const insuranceMock = {
    getInstance: jest.fn(async () => insuranceInstance),
  };

  const contractRegistryMock = {
    isNativeContract: jest.fn(async () => isNativeContract),
  };

  const orderbookInstances = new Map();
  const orderbookModuleMock = {
    getOrderbookInstance: jest.fn(async (orderBookKey) => {
      if (orderbookInstances.has(orderBookKey)) return orderbookInstances.get(orderBookKey);

      const instance = {
        orderBooks: {
          [orderBookKey]: {
            buy: [],
            sell: feeCacheBuyHasSell ? [{ id: "sell-1" }] : [],
          },
        },
        calculatePrice: jest.fn(() => 1),
        insertOrder: jest.fn(async (order) => ({ ...order, id: "fee-buy-1" })),
        matchTokenOrders: jest.fn(async () => (feeCacheBuyMatches ? { matches: [{ id: "m1" }] } : { matches: [] })),
        processTokenMatches: jest.fn(async () => true),
        saveOrderBook: jest.fn(async () => true),
      };
      orderbookInstances.set(orderBookKey, instance);
      return instance;
    }),
  };

  jest.doMock("../src/db.js", () => dbMock);
  jest.doMock("../src/txUtils.js", () => ({}));
  jest.doMock("../src/property.js", () => propertyMock);
  jest.doMock("../src/insurance.js", () => insuranceMock);
  jest.doMock("../src/orderbook.js", () => orderbookModuleMock);
  jest.doMock("../src/contractRegistry.js", () => contractRegistryMock);

  const TallyMap = require("../src/tally.js");

  return {
    TallyMap,
    propertyMock,
    insuranceMock,
    contractRegistryMock,
    orderbookModuleMock,
    orderbookInstances,
    feeRows,
    insuranceDeposits,
  };
}

describe("TallyMap vesting dial tests", () => {
  test("property 2 vesting dial moves vesting from id=2 to available id=1 proportionally", async () => {
    const { TallyMap, propertyMock } = createHarness();

    jest
      .spyOn(TallyMap, "getAddressesWithBalanceForProperty")
      .mockResolvedValue([
        { address: "A", available: 60, reserved: 0, margin: 0, vesting: 100, channelBalance: 0 },
        { address: "B", available: 40, reserved: 0, margin: 0, vesting: 100, channelBalance: 0 },
      ]);
    propertyMock.getPropertyData.mockResolvedValue({ totalInCirculation: 100 });
    const updateSpy = jest.spyOn(TallyMap, "updateBalance").mockResolvedValue(undefined);

    await TallyMap.applyVesting(2, 10, 555);

    expect(updateSpy).toHaveBeenCalledTimes(4);
    expect(updateSpy).toHaveBeenNthCalledWith(1, "A", 2, 0, 0, 0, -6, "vestingDebit", 555);
    expect(updateSpy).toHaveBeenNthCalledWith(2, "A", 1, 6, 0, 0, 0, "vestingCredit", 555);
    expect(updateSpy).toHaveBeenNthCalledWith(3, "B", 2, 0, 0, 0, -4, "vestingDebit", 555);
    expect(updateSpy).toHaveBeenNthCalledWith(4, "B", 1, 4, 0, 0, 0, "vestingCredit", 555);
  });

  test("property 3 vesting dial moves vesting from id=3 to available id=4 proportionally", async () => {
    const { TallyMap, propertyMock } = createHarness();

    jest
      .spyOn(TallyMap, "getAddressesWithBalanceForProperty")
      .mockResolvedValue([
        { address: "A", available: 70, reserved: 0, margin: 0, vesting: 200, channelBalance: 0 },
        { address: "B", available: 30, reserved: 0, margin: 0, vesting: 200, channelBalance: 0 },
      ]);
    propertyMock.getPropertyData.mockResolvedValue({ totalInCirculation: 100 });
    const updateSpy = jest.spyOn(TallyMap, "updateBalance").mockResolvedValue(undefined);

    await TallyMap.applyVesting(3, 10, 777);

    expect(updateSpy).toHaveBeenCalledTimes(4);
    expect(updateSpy).toHaveBeenNthCalledWith(1, "A", 3, 0, 0, 0, -7, "vestingDebit", 777);
    expect(updateSpy).toHaveBeenNthCalledWith(2, "A", 4, 7, 0, 0, 0, "vestingCredit", 777);
    expect(updateSpy).toHaveBeenNthCalledWith(3, "B", 3, 0, 0, 0, -3, "vestingDebit", 777);
    expect(updateSpy).toHaveBeenNthCalledWith(4, "B", 4, 3, 0, 0, 0, "vestingCredit", 777);
  });
});

describe("TallyMap fee cache / buyback routing tests", () => {
  test("SPOT fee for non-1 property accrues 100% to fee cache value", async () => {
    const { TallyMap, feeRows, insuranceDeposits } = createHarness();

    await TallyMap.accrueFee(5, 0.12345678, null, 1001);

    const row = feeRows.get("5-1");
    expect(row).toBeDefined();
    expect(row.value).toBeCloseTo(0.12345678, 8);
    expect(row.stash).toBeCloseTo(0, 8);
    expect(row.contract).toBe("1");
    expect(insuranceDeposits.length).toBe(0);
  });

  test("SPOT fee for property 1 goes directly to insurance", async () => {
    const { TallyMap, insuranceDeposits } = createHarness();

    await TallyMap.accrueFee(1, 0.02, null, 1002);

    expect(insuranceDeposits.length).toBe(1);
    expect(insuranceDeposits[0]).toEqual(["1", "0.02000000", 1002]);
  });

  test("non-native contract splits fee 50/50: insurance now, stash in fee cache (TLI collateral path)", async () => {
    const { TallyMap, feeRows, insuranceDeposits } = createHarness({ isNativeContract: false });

    await TallyMap.accrueFee(4, 1.00000001, 9, 1003);

    const row = feeRows.get("4-9");
    expect(row).toBeDefined();
    expect(row.value).toBeCloseTo(0, 8);
    expect(row.stash).toBeCloseTo(0.50000001, 8);
    expect(row.contract).toBe("9");

    expect(insuranceDeposits.length).toBe(1);
    expect(insuranceDeposits[0][0]).toBe(4);
    expect(insuranceDeposits[0][1]).toBeCloseTo(0.5, 8);
    expect(insuranceDeposits[0][2]).toBe(1003);
  });

  test("feeCacheBuy executes a buy against 1-property orderbook and clears value+stash on match", async () => {
    const { TallyMap, feeRows, orderbookInstances } = createHarness({ feeCacheBuyHasSell: true });

    feeRows.set("5-1", { value: 1.25, stash: 0.75, contract: "1" });
    await TallyMap.feeCacheBuy(1004);

    const ob = orderbookInstances.get("1-5");
    expect(ob).toBeDefined();
    expect(ob.insertOrder).toHaveBeenCalledTimes(1);
    expect(ob.insertOrder.mock.calls[0][0]).toMatchObject({
      offeredPropertyId: "5",
      desiredPropertyId: 1,
      amountOffered: 2,
      sender: "feeCache",
    });
    expect(ob.processTokenMatches).toHaveBeenCalledTimes(1);

    const row = feeRows.get("5-1");
    expect(row.value).toBeCloseTo(0, 8);
    expect(row.stash).toBeCloseTo(0, 8);
  });

  test("oracle split stash is spendable via drawOnFeeCache(allowStash) for downstream TLI distribution", async () => {
    const { TallyMap, feeRows } = createHarness({ isNativeContract: false });

    await TallyMap.accrueFee(4, 1.00000001, 9, 1005);
    const spent = await TallyMap.drawOnFeeCache(4, 9, { max: 0.25, allowStash: true });
    expect(spent.spent.toFixed(8)).toBe("0.25000000");

    const row = feeRows.get("4-9");
    expect(row.stash).toBeCloseTo(0.25000001, 8);
  });
});
