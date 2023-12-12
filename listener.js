const express = require('express');
const TallyMap = require('./tally.js');
const TxIndex = require('./txIndex.js');
const PropertyManager = require('./property.js');
const Interface = require('./interface.js');
const interfaceInstance = new Interface();
const Main = require('./main.js');

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

// Add other endpoints similarly, replacing cases in your switch statement
// Example for 'getAllBalancesForAddress'
app.post('/getAllBalancesForAddress', async (req, res) => {
    try {
        console.log(req.body.address)
        const balances = await TallyMap.getAddressBalances(req.body.address);
        res.status(200).json(balances);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/listProperties', async (req, res) => {
    try {
        console.log('fetching property list')
        const properties = await PropertyManager.getPropertyIndex();
        res.json(properties);
    } catch (error) {
        //res.status(500).send('Error: ' + error.message);
    }
});

// Endpoint to check the initialization status
app.get('/initStatus', (req, res) => {
    res.json({ initialized: isInitialized });
});

// ... Add other endpoints ...

app.listen(port, () => {
    console.log(`Express server running on port ${port}`);
});
