describe('protocolApp bootstrap entrypoint', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('uses provided runtime dependencies without calling init()', async () => {
    const initMock = jest.fn();
    const configureRuntime = jest.fn(async () => undefined);
    const mainInstance = { initialize: jest.fn(async () => undefined) };
    const getInstance = jest.fn(async () => mainInstance);

    jest.doMock('../src/init', () => initMock);
    jest.doMock('../src/main', () => ({ configureRuntime, getInstance }));
    jest.doMock('../src/activation', () => ({ getInstance: jest.fn() }));
    jest.doMock('../src/db', () => ({}));

    const { createProtocolApp } = require('../src/protocolApp');
    const client = { chain: 'LTC' };
    const db = { initialized: true };
    const activation = { init: jest.fn(async () => undefined) };

    const out = await createProtocolApp({
      client,
      db,
      activation,
      initActivation: false,
      initializeMain: false
    });

    expect(initMock).not.toHaveBeenCalled();
    expect(configureRuntime).toHaveBeenCalledWith({ client, db, activation });
    expect(getInstance).toHaveBeenCalledTimes(1);
    expect(mainInstance.initialize).not.toHaveBeenCalled();
    expect(out.client).toBe(client);
    expect(out.db).toBe(db);
  });

  test('boots through init() and initializes main by default', async () => {
    const bootClient = { chain: 'LTC' };
    const bootDb = { initialized: true };
    const initMock = jest.fn(async () => ({ Client: bootClient, Db: bootDb }));
    const configureRuntime = jest.fn(async () => undefined);
    const mainInstance = { initialize: jest.fn(async () => undefined) };
    const getInstance = jest.fn(async () => mainInstance);
    const activation = { init: jest.fn(async () => undefined) };
    const getActivationInstance = jest.fn(() => activation);

    jest.doMock('../src/init', () => initMock);
    jest.doMock('../src/main', () => ({ configureRuntime, getInstance }));
    jest.doMock('../src/activation', () => ({ getInstance: getActivationInstance }));
    jest.doMock('../src/db', () => ({}));

    const { createProtocolApp } = require('../src/protocolApp');
    const out = await createProtocolApp();

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(getActivationInstance).toHaveBeenCalledTimes(1);
    expect(activation.init).toHaveBeenCalledTimes(1);
    expect(configureRuntime).toHaveBeenCalledWith({
      client: bootClient,
      db: bootDb,
      activation
    });
    expect(mainInstance.initialize).toHaveBeenCalledTimes(1);
    expect(out.main).toBe(mainInstance);
  });
});
