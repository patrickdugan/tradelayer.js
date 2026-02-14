describe('Virtual AMM sender collateral handling', () => {
  test('moveCollateralToMargin skips tally movement for virtual AMM sender', async () => {
    jest.resetModules();

    const tallyMock = {
      updateBalance: jest.fn(async () => {}),
      getTally: jest.fn(async () => ({ available: 0, reserved: 0, margin: 0 }))
    };
    const setInitialMargin = jest.fn(async (_sender, _cid, totalInitialMargin, _block, position) => ({
      ...(position || {}),
      margin: totalInitialMargin
    }));

    jest.doMock('../src/tally.js', () => tallyMock);
    jest.doMock('../src/marginMap.js', () => ({
      getInstance: jest.fn(async () => ({
        setInitialMargin
      }))
    }));

    const ContractRegistry = require('../src/contractRegistry.js');
    jest.spyOn(ContractRegistry, 'getInitialMargin').mockResolvedValue(11.15444);
    jest.spyOn(ContractRegistry, 'getCollateralId').mockResolvedValue(5);

    const feeInfo = {
      buyFeeFromReserve: false,
      sellFeeFromReserve: false,
      buyerFee: 0,
      sellerFee: 0
    };
    const position = { contracts: 0, margin: 0 };

    await ContractRegistry.moveCollateralToMargin(
      'amm',
      3,
      1,
      100,
      100,
      true,
      11.15444,
      false,
      null,
      200,
      feeInfo,
      true,
      false,
      'tx-amm',
      position
    );

    expect(setInitialMargin).toHaveBeenCalledWith('amm', 3, 11.15444, 200, position);
    expect(tallyMock.updateBalance).not.toHaveBeenCalled();
    expect(tallyMock.getTally).not.toHaveBeenCalled();
  });
});
