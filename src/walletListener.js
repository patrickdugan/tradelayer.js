const ClientWrapper = require('./client.js');
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
const Consensus = require('./consensus.js')
const Channels = require('./channels.js')
const Types = require('./types.js')


let isInitialized = false; // A flag to track the initialization status
const app = express();
const port = 3000; // Choose a port that suits your setup

app.use(express.json()); // Middleware to parse JSON bodies

// Initialize Main
app.post('/tl_initmain', async (req, res) => {
    try {
        console.log('Initializing');
        const mainProcessor = await Main.getInstance(req.body.test);
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


app.post('/tl_getTransaction', async (req, res) => {
    try {
        const { txid } = req.body;
        const txInfo = await Consensus.getTxParams(txid)
        res.json(txInfo);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getChannelColumn', async (req,res) =>{
    try {
        const { channelAddress, cpAddress } = req.body;
        const column = await Channels.assignColumnBasedOnAddress(channelAddress,cpAddress)
        res.json(column);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
})

/*app.post('/tl_decodeTx', async (req, res) => {
    try {
        const { txid } = req.body;
        const txData = await TxIndex.getTx(txid)
        const txId = txData.value[0].txId;

        res.json(txInfo);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});*/

app.post('./tl_loadWallet', async (req, res) => {
    try {
        const {} = req.body;
        const wallet = TxUtils.load()
        res.json('loading wallet');
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_gettransactionsforaddress', async (req, res) => {
    try {
        const { address } = req.body;
        const txInfo = await Consensus.getTxParamsForAddress(address)
        res.json(txInfo);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});


app.post('/tl_gettransactionforblock', async (req, res) => {
    try {
        const { blockHeight } = req.body;
        const txInfo = await Consensus.getTxParamsForBlock(blockHeight)
        res.json(txInfo);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getMaxProcessedHeight', async (req, res) => {
    try {
        const {} = req.body;
        const txInfo = await Consensus.getMaxProcessedBlock()
        res.json(txInfo);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getMaxParsedHeight', async (req, res) => {
    try {
        const {} = req.body;
        const height = await TxIndex.findMaxIndexedBlock()
        res.json(height);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_pause', async (req, res) => {
    try {
        const {} = req.body;
        const pause = Main.setPause()
        res.json(pause);
    } catch (error) {
        console.error('Error validating address:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Get all balances for an address
app.post('/tl_getAllBalancesForAddress', async (req, res) => {
    console.log('Trying to load balances for: ' + req.body.params);

    try {
        const balances = await TallyMap.getAddressBalances(req.body.params);
        res.status(200).json(balances);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getChannel', async (req, res) => {
    console.log('Trying to load channel for: ' + req.body.params);

    try {
        // Fetch the channel information
        const channel = await Channels.getChannel(req.body.params);

        // Handle the case where the channel is undefined or null (no channel exists)
        if (!channel) {
            return res.status(200).json({ message: 'No channel found for the given address', channel: null });
        }

        // If the channel exists, return it as a successful response
        return res.status(200).json(channel);
    } catch (error) {
        // Handle other unexpected errors and return a 500 status for genuine server-side issues
        console.error('Error loading channel:', error);
        return res.status(500).send('Error: ' + error.message);
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

app.post('/tl_getProperty', async (req, res) => {
    try {
        const pid = req.body.params;
        console.log('tl_getproperty: ' + pid);
        const data = await PropertyManager.getPropertyData(pid);
        res.json(data);
    } catch (error) {
        console.error('Error fetching property data:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// List properties
app.post('/tl_listProperties', async (req, res) => {
    try {
        console.log('Express calling property list');
        const propertiesArray = await PropertyManager.getPropertyIndex();
        res.json(propertiesArray);
    } catch (error) {
        console.error('Error fetching property list:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_listClearlists', async (req, res) => {
    try {
        console.log('Express calling clearlists');
        const clearLists = await Clearlist.loadClearlists();
        res.json(propertiesArray);
    } catch (error) {
        console.error('Error fetching property list:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_showClearlist', async (req, res) => {
    try {
        console.log('Express calling clearlist');
        {id}= req.body
        const clearLists = await Clearlist.getList(id);
        res.json(propertiesArray);
    } catch (error) {
        console.error('Error fetching property list:', error);
        res.status(500).send('Error: ' + error.message);
    }
});


app.post('/tl_listFeeCache', async(req,res)=>{
    try{
        console.log('Pulling fees for all properties');
        const feeCache = await PropertyManager.loadFeeCacheFromDB();
        res.json(feeCache);
    } catch (error) {
        console.error('Error fetching fee cache', error);
        res.status(500).send('Error: ' + error.message);
    }
})

app.post('/tl_propertyFeeCache', async(req,res)=>{
    try{
        console.log('Pulling fees for all properties');
        const feeCache = await PropertyManager.loadFeeCacheForProperty(req.id);
        res.json(feeCache);
    } catch (error) {
        console.error('Error fetching fee cache', error);
        res.status(500).send('Error: ' + error.message);
    }
})

// Get activations
app.post('/tl_getActivations', async (req, res) => {
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
app.post('/tl_getOrderbook', async (req, res) => {
    try {
        const { propertyId1, propertyId2 } = req.body;
        const orderBookKey = `${propertyId1}-${propertyId2}`;
        const orderbook = new Orderbook(orderBookKey);
        const orderBookData = await orderbook.loadOrderBook(orderBookKey);
        res.json(orderBookData);
    } catch (error) {
        console.error('Error fetching order book:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Get contract order book
app.post('/tl_getContractOrderbook', async (req, res) => {
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
app.post('/tl_listContractSeries', async (req, res) => {
    try {
        console.log('Fetching contract series list');
        const { contractId } = req.body;
        const contractSeriesArray = await ContractRegistry.getContractInfo(contractId);
        console.log('Contract series array ' + JSON.stringify(contractSeriesArray));
        res.json(contractSeriesArray);
    } catch (error) {
        console.error('Error fetching contract series:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// List oracles
app.post('/tl_listOracles', async (req, res) => {
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
app.get('/tl_contractPosition', async (req, res) => {
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
app.get('/tl_tradeHistory', async (req, res) => {
    try {
        const { propertyId1, propertyId2 } = req.query;
        const tradeHistory = await Orderbook.getTradeHistoryByPropertyIdPair(propertyId1, propertyId2);
        console.log('Returning trade history ' + JSON.stringify(tradeHistory));
        res.json(tradeHistory);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get initial margin for wallet UI and associated parameters (like commiting to channel for a contract trade)
app.get('/tl_getInitMargin', async (req, res) => {
    try {
        const { contractId, price } = req.query;
        const initialMargin = await ContractRegistry.getInitialMargin(contractId, price);
        console.log('Init. Margin for contract at price ' + JSON.stringify(initialMargin));
        res.json(initialMargin);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get contract trade history
app.get('/tl_contractTradeHistory', async (req, res) => {
    try {
        const { contractId } = req.query;
        const contractTradeHistory = await Orderbook.getContractTradeHistoryByContractId(contractId);
        res.json(contractTradeHistory);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get funding history
app.get('/tl_fundingHistory', async (req, res) => {
    try {
        const { contractId } = req.query;
        const fundingHistory = await ContractsRegistry.loadFundingEvents(contractId);
        res.json(fundingHistory);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// Get oracle history
app.get('/tl_oracleHistory', async (req, res) => {
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
