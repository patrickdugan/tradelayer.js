const axios = require('axios');
const serverUrl = 'http://localhost:3000'; // Adjust the server URL as needed

const expressInterface = {
    async initMain() {
        try {
            const response = await axios.post(`${serverUrl}/tl_initmain`, { test: true });
            console.log(response.data);
            return response
        } catch (error) {
            console.error('initMain failed:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async listProperties() {
        try {
            const response = await axios.post(`${serverUrl}/tl_listProperties`);
            return response.data;
        } catch (error) {
            console.error('Error in listProperties:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getContractInfo(contractId) {
      try {
        const response = await axios.get(`${serverUrl}/tl_getContractInfo`, {
          params: { contractId }
        });
        return response.data;
      } catch (error) {
        console.error(
          'Error in getContractInfo:',
          error.response ? error.response.data : error.message
        );
        throw error;
      }
    },

    async getInitialMargin(contractId, price) {
      try {
        const response = await axios.get(`${serverUrl}/tl_getInitMargin`, {
          params: { contractId, price }
        });
        return Number(response.data);
      } catch (error) {
        console.error(
          'Error in getInitialMargin:',
          error.response ? error.response.data : error.message
        );
        throw error;
      }
    },



    async getAllBalancesForAddress(address) {
        try {
            const response = await axios.post(`${serverUrl}/tl_getAllBalancesForAddress`, { params: address });
            return response.data;
        } catch (error) {
            console.error('Error in getAllBalancesForAddress:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getStateSnapshot(label = 'TL') {
      try {
        const response = await axios.post(`${serverUrl}/tl_getStateSnapshot`, { label });
        return response.data;
      } catch (error) {
        console.error('Error in getStateSnapshot:', error.response ? error.response.data : error.message);
        throw error;
      }
    },

    async callAllocatedRpc(method, params = [], providerNodeId, options = {}) {
        try {
            const response = await axios.post(`${serverUrl}/tl_allocatedRpc`, {
                method,
                params,
                providerNodeId,
                network: options.network,
                service: options.service,
                timeoutMs: options.timeoutMs,
            });
            return response.data;
        } catch (error) {
            console.error('Error in callAllocatedRpc:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getActivations() {
        try {
            const response = await axios.post(`${serverUrl}/tl_getActivations`);
            return response.data;
        } catch (error) {
            console.error('Error in getActivations:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getOrderBook(params) {
        try {
            const propertyId1 = params?.propertyId1 ?? params?.id1;
            const propertyId2 = params?.propertyId2 ?? params?.id2;
            const response = await axios.post(`${serverUrl}/tl_getOrderbook`, { propertyId1, propertyId2 });
            return response.data;
        } catch (error) {
            console.error('Error in getOrderBook:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getContractOrderBook(params) {
        try {
            const contractId = params?.contractId ?? params?.id;
            const response = await axios.post(`${serverUrl}/tl_getContractOrderbook`, { contractId });
            return response.data;
        } catch (error) {
            console.error('Error in getOrderBook:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async listContractSeries() {
        try {
            const response = await axios.post(`${serverUrl}/tl_listContractSeries`);
            return response.data;
        } catch (error) {
            console.error('Error in listContractSeries:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async listOracles() {
        try {
            const response = await axios.post(`${serverUrl}/tl_listOracles`);
            return response.data;
        } catch (error) {
            console.error('Error in listOracles:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getColumn(params, maybeAddressB = null) {
        try {
            let channelAddress = null;
            let newCommitAddress = null;
            let cpAddress = null;

            if (typeof params === 'string') {
                newCommitAddress = params;
                cpAddress = maybeAddressB;
            } else if (Array.isArray(params)) {
                [newCommitAddress, cpAddress, channelAddress] = params;
            } else if (params && typeof params === 'object') {
                const {
                    channelAddress: argChannelAddress,
                    channel,
                    newCommitAddress: argNewCommitAddress,
                    cpAddress: argCpAddress,
                    addressA,
                    addressB
                } = params;

                channelAddress = argChannelAddress || channel;
                newCommitAddress = argNewCommitAddress || addressA;
                cpAddress = argCpAddress || addressB;
            }

            if (!newCommitAddress || !cpAddress) {
                throw new Error('Missing channel column params');
            }

            const response = await axios.get(
                `${serverUrl}/tl_getChannelColumn`,
                {
                    params: {
                        channelAddress,
                        newCommitAddress,
                        cpAddress
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(
                'Error in getContractPositionForAddressAndContractId:',
                error.response ? error.response.data : error.message
            );
            throw error;
        }
    },


    async getContractPositionForAddressAndContractId(params) {
        try {
            const { address, contractId } = params;
            const response = await axios.get(`${serverUrl}/tl_contractPosition`, {
                params: { address, contractId }
            });
            return response.data;
        } catch (error) {
            console.error('Error in getContractPositionForAddressAndContractId:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getTradeHistory(params) {
        try {
            const propertyId1 = params?.propertyId1 ?? params?.id1;
            const propertyId2 = params?.propertyId2 ?? params?.id2;
            const response = await axios.get(`${serverUrl}/tl_tradeHistory`, {
                params: { propertyId1, propertyId2 }
            });
            return response.data;
        } catch (error) {
            console.error('Error in getTradeHistory:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getContractTradeHistory(params) {
        try {
            const { contractId } = params;
            const response = await axios.get(`${serverUrl}/tl_contractTradeHistory`, {
                params: { contractId }
            });
            return response.data;
        } catch (error) {
            console.error('Error in getContractTradeHistory:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getFundingHistory(params) {
        try {
            const { contractId } = params;
            const response = await axios.get(`${serverUrl}/tl_fundingHistory`, {
                params: { contractId }
            });
            return response.data;
        } catch (error) {
            console.error('Error in getFundingHistory:', error.response ? error.response.data : error.message);
            throw error;
        }
    },

    async getOracleHistory(params) {
        try {
            const contractId = params?.contractId ?? params?.oracleId;
            const response = await axios.get(`${serverUrl}/tl_oracleHistory`, {
                params: { contractId }
            });
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
    },

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
