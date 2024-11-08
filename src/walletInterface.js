const axios = require('axios');
const serverUrl = 'http://localhost:3000'; // Adjust the server URL as needed

const expressInterface = {
    async initMain() {
        try {
            const response = await axios.post(`${serverUrl}/tl_initmain`, { test: true });
            console.log(response.data);
        } catch (error) {
            console.error('Error:', error.response ? error.response.data : error.message);
        }
    },

    async listProperties() {
        try {
            const response = await axios.post(`${serverUrl}/tl_listproperties`);
            return response.data;
        } catch (error) {
            console.error('Error in listProperties:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getAllBalancesForAddress(params) {
        try {
            const response = await axios.post(`${serverUrl}/tl_getallbalancesforaddress`, { params:[address] });
            return response.data;
        } catch (error) {
            console.error('Error in getAllBalancesForAddress:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getActivations() {
        try {
            const response = await axios.post(`${serverUrl}/tl_getactivations`);
            return response.data;
        } catch (error) {
            console.error('Error in getActivations:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getOrderBook(params) {
        try {
            const response = await axios.post(`${serverUrl}/tl_getorderbook`, { propertyId1, propertyId2 });
            return response.data;
        } catch (error) {
            console.error('Error in getOrderBook:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getContractOrderBook(params) {
        try {
            const response = await axios.post(`${serverUrl}/tl_getcontractorderbook`, {contractId });
            return response.data;
        } catch (error) {
            console.error('Error in getOrderBook:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async listContractSeries() {
        try {
            const response = await axios.post(`${serverUrl}/tl_listcontractseries`);
            return response.data;
        } catch (error) {
            console.error('Error in listContractSeries:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async listOracles() {
        try {
            const response = await axios.post(`${serverUrl}/tl_listoracles`);
            return response.data;
        } catch (error) {
            console.error('Error in listOracles:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getContractPositionForAddressAndContractId(params) {
        try {
            const { address, contractId } = params;
            const response = await axios.get(`${serverUrl}/tl_contractposition`, { address, contractId});
            return response.data;
        } catch (error) {
            console.error('Error in getContractPositionForAddressAndContractId:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getTradeHistory(params) {
        try {
            const { propertyId1, propertyId2 } = params;
            const response = await axios.get(`${serverUrl}/tl_tradehistory`, { propertyId1, propertyId2 });
            return response.data;
        } catch (error) {
            console.error('Error in getTradeHistory:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getContractTradeHistory(params) {
        try {
            const { contractId } = params;
            const response = await axios.get(`${serverUrl}/tl_contracttradehistory`, { contractId });
            return response.data;
        } catch (error) {
            console.error('Error in getContractTradeHistory:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getFundingHistory(params) {
        try {
            const { contractId } = params;
            const response = await axios.get(`${serverUrl}/tl_fundinghistory`, { contractId });
            return response.data;
        } catch (error) {
            console.error('Error in getFundingHistory:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getOracleHistory(params) {
        try {
            const { oracleId } = params;
            const response = await axios.get(`${serverUrl}/tl_oraclehistory`, { oracleId });
            return response.data;
        } catch (error) {
            console.error('Error in getOracleHistory:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getMaxProcessedHeight() {
        try {
            const response = await axios.post(`${serverUrl}/tl_getMaxProcessedHeight`, {});
            return response.data;
        } catch (error) {
            console.error('Error in getMaxProcessedHeight:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getTrackHeight() {
        try {
            const response = await axios.post(`${serverUrl}/tl_getTrackHeight`, {});
            return response.data;
        } catch (error) {
            console.error('Error in getMaxProcessedHeight:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async checkSync() {
        try {
            const response = await axios.post(`${serverUrl}/tl_checkSync`, {});
            return response.data;
        } catch (error) {
            console.error('Error in getMaxProcessedHeight:', error.response ? error.response.data : error.message);
            throw error;
        }
    }

}

module.exports= expressInterface