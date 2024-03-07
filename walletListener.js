const express = require('express');
const axios = require('axios');
const TallyMap = require('./tally.js');
const TxIndex = require('./txIndex.js');
const PropertyManager = require('./property.js');
const Main = require('./main.js');
const Activations = require('./activation.js');
const Orderbook = require('./orderbook.js');
const ContractRegistry = require('./contractRegistry.js');
const OracleList = require('./oracle.js');
const MarginMap = require('./marginMap.js');
const TxUtils = require('./txUtils.js')

let isInitialized = false; // A flag to track the initialization status
const app = express();
const port = 3000; // Choose a port that suits your setup

app.use(express.json()); // Middleware to parse JSON bodies

app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

// Initialize Main
app.post('/tl_initmain', async (req, res) => {
    try {
        console.log('Initializing');
        const mainProcessor = Main.getInstance(req.body.test);
        mainProcessor.initialize();
        res.status(200).send('Main process initialized successfully');
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Validate address
app.post('/tl_validateaddress', async (req, res) => {
    try {
        const { address } = req.body;
        const validationResponse = await TxUtils.validateAddress(address)
        res.json(validationResponse);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Get all balances for an address
app.post('/tl_getallbalancesforaddress', async (req, res) => {
    console.log('Trying to load balances for: ' + req.body.params);

    try {
        const tallyMapInstance = await TallyMap.getInstance();
        if (!tallyMapInstance) {
            throw new Error("Failed to get TallyMap instance");
        }
        await tallyMapInstance.loadFromDB();
        const balances = tallyMapInstance.getAddressBalances(req.body.params);
        res.status(200).json(balances);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Add OP_Return to tx blob
app.post('/tl_createrawtx_opreturn', async (req, res) => {
    try {
        const [txHex, payload] = req.body.params;
        const payloadedTx = await TxUtils.addOPReturn(txHex, payload);
        const result = { data: payloadedTx.toString('hex') };
        res.status(200).send(result);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_getAllBalancesForAddress/:addr', async (req, res) => {
    console.log('tl_getAllBalancesForAddress: ' + req.params?.addr);
    try {
        const balances = (await TallyMap.getInstance()).getAddressBalances(req.params?.addr);
        res.status(200).json(balances);
    } catch (error) {
        console.error(error); // Log the full error for debugging
        res.status(500).send('Error: ' + error.message);
    }
});


app.get('/tl_getproperty/:pid', async (req, res) => {
    try {
        const pid = parseInt(req.params.pid);
        console.log('tl_getproperty: ' + pid);
        const data = await PropertyManager.getPropertyData(pid);
        res.json(data);
    } catch (error) {
        console.error('Error fetching property data:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_listproperties', async (req, res) => {
    try {
        console.log('/tl_listproperties');
        const propertiesArray = await PropertyManager.getPropertyIndex();
        res.json(propertiesArray);
    } catch (error) {
        console.error('Error fetching property list:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_getchaininfo', async (req, res) => {
    try {
        console.log('/tl_getchaininfo');
        const data = await TxUtils.getBlockchainInfo();
        res.json(data);
    } catch (error) {
        console.error('Error /tl_getchaininfo:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_listFeeCache', async (req, res) => {
    try {
        console.log('Pulling fees for all properties');
        const feeCache = await TallyMap.loadFeeCacheFromDB();
        res.json(feeCache);
    } catch (error) {
        console.error('Error fetching fee cache', error);
        res.status(500).send('Error: ' + error.message);
    }
})

app.get('/tl_propertyFeeCache/:pid', async (req, res) => {
    try {
        console.log(`tl_propertyFeeCache: ${req.params?.pid}`);
        const feeCache = await TallyMap.loadFeeCacheForProperty(`feeCache-${req.params.pid}`);
        res.json({feeCache});
    } catch (error) {
        console.error('Error fetching fee cache', error);
        res.status(500).send('Error: ' + error.message);
    }
})

app.get('/tl_getTxData/:tid', async (req, res) => {
    try {
        console.log(`tl_getTxData: ${req.params?.tid}`);
        const data = await TxIndex.getTransactionData(req.params?.tid);
        res.json(data);
    } catch (error) {
        console.error('Error tl_getTxData: ', error);
        res.status(500).send('Error: ' + error.message);
    }
})

// Get activations
app.post('/tl_getactivations', async (req, res) => {
    try {
        console.log('Express calling activations');
        const activations = await Activations.getInstance().loadActivationsList();
        res.json(activations);
    } catch (error) {
        console.error('Error fetching activations:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Get order book
app.post('/tl_getorderbook', async (req, res) => {
    try {
        const { propertyId1, propertyId2 } = req.body;
        const orderBookKey = `${propertyId1}-${propertyId2}`;
        const orderbook = new Orderbook(orderBookKey);
        await orderbook.loadOrCreateOrderBook();
        const orderBookData = orderbook.orderBooks[orderBookKey] || {};
        res.json(orderBookData);
    } catch (error) {
        console.error('Error fetching order book:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Get contract order book
app.post('/tl_getcontractorderbook', async (req, res) => {
    try {
        const { contractId } = req.body;
        const orderBookKey = `contract-${contractId}`;
        const orderbook = new Orderbook(orderBookKey);
        await orderbook.loadOrCreateOrderBook();
        const orderBookData = orderbook.getOrderBookData();
        res.json(orderBookData);
    } catch (error) {
        console.error('Error fetching contract order book:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// List contract series
app.post('/tl_listcontractseries', async (req, res) => {
    try {
        console.log('Fetching contract series list');
        const contractSeriesArray = await ContractRegistry.getAllContracts();
        console.log('Contract series array ' + JSON.stringify(contractSeriesArray));
        res.json(contractSeriesArray);
    } catch (error) {
        console.error('Error fetching contract series:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// List oracles
app.post('/tl_listoracles', async (req, res) => {
    try {
        console.log('Fetching oracle list');
        const oracleArray = await OracleList.getAllOracles();
        res.json(oracleArray);
    } catch (error) {
        console.error('Error fetching oracle list:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Get contract position for address and contract ID
app.get('/tl_contractposition', async (req, res) => {
    try {
        const { address, contractId } = req.query;
        const marginMap = await MarginMap.getInstance(contractId);
        const position = marginMap.getPositionForAddress(address);
        res.json(position);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get trade history
app.get('/tl_tradehistory', async (req, res) => {
    try {
        const { propertyId1, propertyId2 } = req.query;
        const tradeHistory = await Orderbook.getTradeHistoryByPropertyIdPair(propertyId1, propertyId2);
        console.log('Returning trade history ' + JSON.stringify(tradeHistory));
        res.json(tradeHistory);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get contract trade history
app.get('/tl_contracttradehistory', async (req, res) => {
    try {
        const { contractId } = req.query;
        const contractTradeHistory = await Orderbook.getContractTradeHistoryByContractId(contractId);
        res.json(contractTradeHistory);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get funding history
app.get('/tl_fundinghistory', async (req, res) => {
    try {
        const { contractId } = req.query;
        const fundingHistory = await ContractsRegistry.loadFundingEvents(contractId);
        res.json(fundingHistory);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get oracle history
app.get('/tl_oraclehistory', async (req, res) => {
    try {
        const { contractId } = req.query;
        const oracleHistory = await Oracles.getHistory(contractId);
        res.json(oracleHistory);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// ... Other endpoints ...

app.listen(port, () => {
    // const params = ['a1','c3'];
    // const body = { params };
    // console.log(`body:${JSON.stringify(body)}`)
    console.log(`Express server running on port ${port}`);
});
