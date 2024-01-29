const express = require('express');
const axios = require('axios');
const Interface = require('./interface.js');
const interfaceInstance = new Interface();

const app = express();
const port = 3000;

app.use(express.json());

app.post('/tl_initmain', async (req, res) => {
    try {
        const response = await interfaceInstance.initMain();
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_listproperties', async (req, res) => {
    try {
        const response = await interfaceInstance.listProperties();
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getallbalancesforaddress', async (req, res) => {
    try {
        const response = await interfaceInstance.getAllBalancesForAddress(req.body.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getactivations', async (req, res) => {
    try {
        const response = await interfaceInstance.getActivations();
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getorderbook', async (req, res) => {
    try {
        const response = await interfaceInstance.getOrderBook(req.body.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_getcontractorderbook', async (req, res) => {
    try {
        const response = await interfaceInstance.getContractOrderBook(req.body.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_listcontractseries', async (req, res) => {
    try {
        const response = await interfaceInstance.listContractSeries();
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.post('/tl_listoracles', async (req, res) => {
    try {
        const response = await interfaceInstance.listOracles();
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_contractposition', async (req, res) => {
    try {
        const response = await interfaceInstance.getContractPositionForAddressAndContractId(req.query.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_tradehistory', async (req, res) => {
    try {
        const response = await interfaceInstance.getTradeHistory(req.query.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_contracttradehistory', async (req, res) => {
    try {
        const response = await interfaceInstance.getContractTradeHistory(req.query.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_fundinghistory', async (req, res) => {
    try {
        const response = await interfaceInstance.getFundingHistory(req.query.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

app.get('/tl_oraclehistory', async (req, res) => {
    try {
        const response = await interfaceInstance.getOracleHistory(req.query.params);
        res.json(response);
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// ... Other endpoints ...

app.listen(port, () => {
    console.log(`Express server running on port ${port}`);
});
