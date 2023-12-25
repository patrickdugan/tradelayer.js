const express = require('express');
const TallyMap = require('./tally.js');
const TxIndex = require('./txIndex.js');
const PropertyManager = require('./property.js');
const Interface = require('./interface.js');
const interfaceInstance = new Interface();
const Main = require('./main.js');
const Activations = require('./activation.js')
const Orderbook = require('./orderbook.js')
var activationsInstance = Activations.getInstance()

let isInitialized = false; // A flag to track the initialization status
const app = express();
const port = 3000; // Choose a port that suits your setup

app.use(express.json()); // Middleware to parse JSON bodies

app.post('/initMain', async (req, res) => {
    try {
        console.log('Initializing');
        const mainProcessor = Main.getInstance(req.body.test); // Use req.body for arguments
        mainProcessor.initialize();
        res.status(200).send('Main process initialized successfully');
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/getAllBalancesForAddress', async (req, res) => {
            console.log('trying to load balances' +req.body.address)

    try {
        const tallyMapInstance = await TallyMap.getInstance();
        if (!tallyMapInstance) {
            throw new Error("Failed to get TallyMap instance");
        }
        await tallyMapInstance.loadFromDB(); // Wait for the tally map to load
        const balances = tallyMapInstance.getAddressBalances(req.body.address);
        res.status(200).json(balances);
    } catch (error) {
        console.error(error); // Log the full error for debugging
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/listProperties', async (req, res) => {
    try {
        console.log('express calling property list');
        const propertiesArray = await PropertyManager.getPropertyIndex(); // Await the getPropertyIndex method
        res.json(propertiesArray); // Send the array representation of the properties
    } catch (error) {
        console.error('Error fetching property list:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/addressesWithProperty/:propertyId', async (req, res) => {
    try {
        const propertyId = parseInt(req.params.propertyId);
        const addresses = await TallyMap.getAddressesWithBalanceForProperty(propertyId);
        res.json(addresses);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.post('/getActivations', async (req, res) => {
    try {
        console.log('express calling activations');
        const activations = await activationsInstance.loadActivationsList(); // Await the getPropertyIndex method
        res.json(activations); // Send the array representation of the properties
    } catch (error) {
        console.error('Error fetching activations:', error);
        res.status(500).send('Error: ' + error.message);
    }
});


// Endpoint to check the initialization status
app.get('/initStatus', (req, res) => {
    res.json({ initialized: isInitialized });
});

app.post('/getOrderBook', async (req, res) => {
    try {
        const { propertyId1, propertyId2 } = req.body;
        const orderBookKey = `${propertyId1}-${propertyId2}`;

        // Instantiate your Orderbook class with the specific orderBookKey
        const orderbook = new Orderbook(orderBookKey);
        await orderbook.loadOrCreateOrderBook(); // Load or create the specific order book

        // Retrieve the specific order book data
        const orderBookData = orderbook.orderBooks[orderBookKey] || {};
        res.json(orderBookData);
    } catch (error) {
        console.error('Error fetching order book:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Endpoint to list all contract series
app.post('/listContractSeries', async (req, res) => {
    try {
        console.log('Fetching contract series list');
        const contractsRegistry = new ContractsRegistry(); // Ensure ContractsRegistry is instantiated
        const contractSeriesArray = contractsRegistry.getAllContracts();
        res.json(contractSeriesArray);
    } catch (error) {
        console.error('Error fetching contract series:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Endpoint to list all oracles
app.post('/listOracles', async (req, res) => {
    try {
        console.log('Fetching oracle list');
        const oracleArray = await OracleRegistry.getAllOracles(); // Implement this in OracleRegistry
        res.json(oracleArray);
    } catch (error) {
        console.error('Error fetching oracle list:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/contractTradeHistory/:contractId', async (req, res) => {
    const { contractId } = req.params;
    const contractTradeHistory = await Orderbook.getContractTradeHistoryByContractId(contractId);
    res.json(contractTradeHistory);
});

app.get('/tradeHistory/:propertyId1/:propertyId2', async (req, res) => {
    const { propertyId1, propertyId2 } = req.params;
    const tradeHistory = await Orderbook.getTradeHistoryByPropertyIdPair(propertyId1, propertyId2);
    res.json(tradeHistory);
});

app.get('/fundingHistory/:contractId', async (req, res) => {
    const { contractId } = req.params;
    const fundingHistory = await ContractsRegistry.loadFundingEvents(contractId);
    res.json(fundingHistory);
});

app.get('/oracleHistory/:contractId', async (req, res) => {
    // Assuming you have an Oracles class
    const { contractId } = req.params;
    const oracleHistory = await Oracles.getHistory(contractId);
    res.json(oracleHistory);
});

app.get('/clearingHistory/:contractId', async (req, res) => {
    // Implement logic to retrieve clearing history
    const { contractId } = req.params;
    // const clearingHistory = ...
    res.json(clearingHistory);
});

app.get('/walletPositions/:address', async (req, res) => {
    const { address } = req.params;
    const positions = await WalletCache.getPositions(address);
    res.json(positions);
});

app.get('/walletBalances/:address', async (req, res) => {
    const { address } = req.params;
    const balances = await WalletCache.getBalance(address);
    res.json(balances);
});

app.get('/contractPosition/:address/:contractId', async (req, res) => {
    const { address, contractId } = req.params;
    try {
        const position = await WalletCache.getContractPositionForAddressAndContractId(address, contractId);
        res.json(position);
    } catch (error) {
        res.status(500).send(error.message);
    }
});


// ... Add other endpoints ...

app.listen(port, () => {
    console.log(`Express server running on port ${port}`);
});
