const { propertyList } = require('./property.js')
const { tlActivation } = require('./activation.js')
const { orderBook } = require('./orderbook.js')
const { contractRegistry } = require('./contractRegistry.js')
const { oracleList } = require('./oracle.js')
const { tallyMap } = require('./tally.js')
const MarginMap = require('./marginMap.js')
const Main = require('./main.js')

let isInitialized = false; // A flag to track the initialization status

const express = require('express')
const app = express()
const port = 3000; // Choose a port that suits your setup

app.use(express.json()) // Middleware to parse JSON bodies

app.post('/initMain', async (req, res) => {
    try {
        console.log('Initializing')
        const mainProcessor = new Main(req.body.test) // Use req.body for arguments
        mainProcessor.initialize()
        res.status(200).send('Main process initialized successfully')
    } catch (error) {
        res.status(500).send('Error: ' + error.message)
    }
})

app.post('/getAllBalancesForAddress', (req, res) => {
    console.log('trying to load balances' + req.body.address)
    try {
        const balances = tallyMap.getAddressBalances(req.body.address)
        res.status(200).json(balances)
    } catch (error) {
        console.error(error) // Log the full error for debugging
        res.status(500).send('Error: ' + error.message)
    }
})

app.post('/listProperties', async (req, res) => {
    try {
        console.log('express calling property list')
        const propertiesArray = await propertyList.getPropertyIndex() // Await the getPropertyIndex method
        res.json(propertiesArray) // Send the array representation of the properties
    } catch (error) {
        console.error('Error fetching property list:', error)
        res.status(500).send('Error: ' + error.message)
    }
})

app.get('/addressesWithProperty/:propertyId', async (req, res) => {
    try {
        const propertyId = parseInt(req.params.propertyId)
        const addresses = await tallyMap.getAddressesWithBalanceForProperty(propertyId)
        res.json(addresses)
    } catch (error) {
        res.status(500).send(error.message)
    }
})

app.post('/getActivations', async (req, res) => {
    try {
        console.log('express calling activations')
        const activations = await tlActivation.loadActivationsList() // Await the getPropertyIndex method
        res.json(activations) // Send the array representation of the properties
    } catch (error) {
        console.error('Error fetching activations:', error)
        res.status(500).send('Error: ' + error.message)
    }
})


// Endpoint to check the initialization status
app.get('/initStatus', (req, res) => {
    res.json({ initialized: isInitialized })
})

app.post('/getOrderBook', async (req, res) => {
    try {
        const { propertyId1, propertyId2 } = req.body;
        const orderBookKey = `${propertyId1}-${propertyId2}`;
        const orderBookData = await orderBook.load(orderBookKey) || {};
        res.json(orderBookData)
    } catch (error) {
        console.error('Error fetching order book:', error)
        res.status(500).send('Error: ' + error.message)
    }
})

app.post('/getContractOrderBook', async (req, res) => {
    try {
        const { contractId } = req.body;
        const orderBookKey = `contract-${contractId}`;
        const orderBookData = await orderBook.load(orderBookKey) || {};
        res.json(orderBookData)
    } catch (error) {
        console.error('Error fetching contract order book:', error)
        res.status(500).send('Error: ' + error.message)
    }
})


app.post('/listContractSeries', async (req, res) => {
    try {
        console.log('Fetching contract series list')
        //const contractsRegistry = ContractRegistry.getInstance() // Access singleton instance
        //console.log(JSON.stringify(contractsRegistry))
        // Assuming loadContractsFromDB is a static method
        //ContractRegistry.loadContractsFromDB() // Load contracts from the database
        //console.log('contract series array '+contractSeriesArray)
        // Assuming getAllContracts is a static method
        const contractSeriesArray = await contractRegistry.getAllContracts() // Get all contract series
        console.log('contract series array ' + JSON.stringify(contractSeriesArray))
        res.json(contractSeriesArray)
    } catch (error) {
        console.error('Error fetching contract series:', error)
        res.status(500).send('Error: ' + error.message)
    }
})

// Endpoint to list all oracles
app.post('/listOracles', async (req, res) => {
    try {
        console.log('Fetching oracle list')
        const oracleArray = await oracleList.getAll() // Implement this in OracleRegistry
        res.json(oracleArray)
    } catch (error) {
        console.error('Error fetching oracle list:', error)
        res.status(500).send('Error: ' + error.message)
    }
})

app.get('/contractTradeHistory/:contractId', async (req, res) => {
    const { contractId } = req.params;
    const contractTradeHistory = await orderBook.getContractTradeHistoryByContractId(contractId)
    res.json(contractTradeHistory)
})

app.get('/tradeHistory/:propertyId1/:propertyId2', async (req, res) => {
    const { propertyId1, propertyId2 } = req.params;
    const tradeHistory = await orderBook.getTradeHistoryByPropertyIdPair(propertyId1, propertyId2)
    console.log('returning trade history ' + JSON.stringify(tradeHistory))
    res.json(tradeHistory)
})

app.get('/fundingHistory/:contractId', async (req, res) => {
    const { contractId } = req.params;
    const fundingHistory = await ContractsRegistry.loadFundingEvents(contractId)
    res.json(fundingHistory)
})

app.get('/oracleHistory/:contractId', async (req, res) => {
    // Assuming you have an Oracles class
    const { contractId } = req.params;
    const oracleHistory = await Oracles.getHistory(contractId)
    res.json(oracleHistory)
})


app.get('/contractPosition/:address/:contractId', async (req, res) => {
    const { address, contractId } = req.params;
    try {
        const marginMap = await MarginMap.load(contractId)
        const position = marginMap.getPositionForAddress(address)
        res.json(position)
    } catch (error) {
        res.status(500).send('Error: ' + error.message)
    }
})

app.get('/clearingHistory/:contractId', async (req, res) => {
    // Implement logic to retrieve clearing history
    const { contractId } = req.params;
    // const clearingHistory = ...
    res.json(clearingHistory)
})

app.get('/walletPositions/:address', async (req, res) => {
    const { address } = req.params;
    const positions = await WalletCache.getPositions(address)
    res.json(positions)
})

app.get('/walletBalances/:address', async (req, res) => {
    const { address } = req.params;
    const balances = await WalletCache.getBalance(address)
    res.json(balances)
})

app.get('/walletPosition/:address/:contractId', async (req, res) => {
    const { address, contractId } = req.params;
    try {
        const position = await WalletCache.getContractPositionForAddressAndContractId(address, contractId)
        res.json(position)
    } catch (error) {
        res.status(500).send(error.message)
    }
})

app.listen(port, () => {
    console.log(`Express server running on port ${port}`)
})
