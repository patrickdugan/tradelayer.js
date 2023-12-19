const axios = require('axios');
const serverUrl = 'http://localhost:3000'; // Adjust the server URL as needed

const expressInterface = {
    async initMain() {
        try {
            const response = await axios.post(`${serverUrl}/initMain`, { test: true });
            console.log(response.data);
        } catch (error) {
            console.error('Error:', error.response ? error.response.data : error.message);
        }
    },

    async listProperties() {
        try {
            const response = await axios.post(`${serverUrl}/listProperties`);
            return response.data;
        } catch (error) {
            //console.error('Error in listProperties:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getAllBalancesForAddress(address) {
        try {
            const response = await axios.post(`${serverUrl}/getAllBalancesForAddress`, { address });
            return response.data;
        } catch (error) {
            console.error('Error in getAllBalancesForAddress:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getActivations() {
        try {
            const response = await axios.post(`${serverUrl}/getActivations`);
            return response.data;
        } catch (error) {
            console.error('Error in getActivations:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getOrderBook(propertyId1, propertyId2) {
        try {
            const response = await axios.post(`${serverUrl}/getOrderBook`, { propertyId1, propertyId2 });
            return response.data;
        } catch (error) {
            console.error('Error in getOrderBook:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async listContractSeries() {
        try {
            const response = await axios.post(`${serverUrl}/listContractSeries`);
            return response.data;
        } catch (error) {
            console.error('Error in listContractSeries:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async listOracles() {
        try {
            const response = await axios.post(`${serverUrl}/listOracles`);
            return response.data;
        } catch (error) {
            console.error('Error in listOracles:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

};

module.exports = expressInterface;
