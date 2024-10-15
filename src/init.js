// init.js
const ClientWrapper = require('./client');
const Database = require('./db');

async function waitForClientChain(client, timeout = 5000, interval = 150) {
    const startTime = Date.now();
    while (!client.chain) {
        if (Date.now() - startTime > timeout) {
            throw new Error('Client chain initialization timed out.');
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}

// Inside your initialize function
async function initialize() {
    const Client = await ClientWrapper.getInstance();
    await waitForClientChain(Client);  // Wait for Client.chain to be defined
    await Database.init(Client.chain);
    return { Client, Db: Database };
}


module.exports = initialize;
