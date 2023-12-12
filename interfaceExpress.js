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
    }
};

module.exports = expressInterface;
