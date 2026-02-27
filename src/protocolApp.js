const initialize = require('./init');
const Main = require('./main');
const Activation = require('./activation');
const Database = require('./db');

async function createProtocolApp(config = {}) {
  const {
    client: providedClient,
    db: providedDb,
    activation: providedActivation,
    initActivation = true,
    initializeMain = true
  } = config;

  let client = providedClient;
  let db = providedDb || null;

  if (!client || !db) {
    const boot = await initialize();
    client = client || boot.Client;
    db = db || boot.Db || Database;
  }

  let activation = providedActivation || null;
  if (initActivation) {
    activation = activation || Activation.getInstance();
    if (activation && typeof activation.init === 'function') {
      await activation.init();
    }
  }

  await Main.configureRuntime({ client, db, activation });
  const main = await Main.getInstance();
  if (initializeMain) {
    await main.initialize();
  }

  return { main, client, db, activation };
}

module.exports = {
  createProtocolApp
};
