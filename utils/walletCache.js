// Import necessary modules and interfaces lazily to keep listener startup light.
const LitecoinModule = require('litecoin');
const util = require('util');
let rpcClient = null;

function getRpcClient() {
    if (rpcClient) return rpcClient;
    const Litecoin = typeof LitecoinModule === 'function'
        ? LitecoinModule
        : LitecoinModule?.default || LitecoinModule?.Litecoin || LitecoinModule?.Client || LitecoinModule;
    const config = {
        host: process.env.RPC_HOST || '127.0.0.1',
        port: Number(process.env.RPC_PORT || 8332),
        user: process.env.RPC_USER || 'user',
        pass: process.env.RPC_PASSWORD || process.env.RPC_PASS || 'pass',
        timeout: Number(process.env.RPC_TIMEOUT_MS || 10000),
    };
    rpcClient = new Litecoin(config);
    return rpcClient;
}

function normalizeAddressesByLabel(result) {
    if (Array.isArray(result)) {
        return result.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    if (result && typeof result === 'object') {
        return Object.keys(result).map((address) => String(address || '').trim()).filter(Boolean);
    }
    return [];
}

async function getAddressesByLabel(client, label) {
    try {
        if (typeof client.getAddressesByLabel === 'function') {
            return normalizeAddressesByLabel(await client.getAddressesByLabel(label));
        }
        if (typeof client.getaddressesbylabel === 'function') {
            return normalizeAddressesByLabel(await client.getaddressesbylabel(label));
        }
        if (typeof client.cmd === 'function') {
            const call = util.promisify(client.cmd.bind(client, 'getaddressesbylabel'));
            return normalizeAddressesByLabel(await call(label));
        }
        throw new Error('Configured Litecoin RPC client does not support getaddressesbylabel');
    } catch (error) {
        if (Number(error?.code) === -11 || /no addresses with label/i.test(String(error?.message || ''))) {
            return [];
        }
        throw error;
    }
}

class WalletCache {
    constructor() {
        this.walletBalancesCache = new Map(); // A map to store wallet balances
    }

    /**
     * Updates the cache with the latest state and returns the number of changes made to wallet addresses.
     */
    
    async updateWalletCache(label) {
        let numChanges = 0;
        const client = getRpcClient();
        const addresses = await getAddressesByLabel(client, label);
        const TallyMap = require('../src/tally.js');

        for (const address of addresses) {
            const balance = await TallyMap.getAddressBalances(address);

            if (!this.walletBalancesCache.has(address) || this.isBalanceDifferent(this.walletBalancesCache.get(address), balance)) {
                numChanges++;
                this.walletBalancesCache.set(address, balance);
            }
        }

        return numChanges;
    }


    async getAllWalletBalances(label) {
            try {
                // Get all TradeLayer addresses with the specified label from the wallet
                const client = getRpcClient();
                const addresses = await getAddressesByLabel(client, label);
                const allBalances = [];
                const TallyMap = require('../src/tally.js');

                // For each TradeLayer address, get all balances
                for (const address of addresses) {
                    const balances = await TallyMap.getAddressBalances(address);
                    allBalances.push({ address, balances });
                }

                return allBalances;
            } catch (error) {
                console.error('Error getting all wallet balances for TradeLayer addresses:', error);
                throw error;
            }
        }


    // Gets the balance for a specific address from the cache
    getBalance(address) {
        return this.walletBalancesCache.get(address) || 0;
    }

    // Gets a map of all addresses with their respective balances
    getAllBalances() {
        return this.walletBalancesCache;
    }

    /**
     * Compares two sets of balance data to determine if they are different.
     */
    isBalanceDifferent(balanceData1, balanceData2) {
        // Implement comparison logic based on your balance data structure
        // Example:
        return JSON.stringify(balanceData1) !== JSON.stringify(balanceData2);
    }


    /**
     * Retrieves contract positions for all addresses in the wallet.
     */
    async getPositions(label = 'TL') {
        try {
            // Get all TradeLayer addresses with the specified label from the wallet
            const client = getRpcClient();
            const addresses = await getAddressesByLabel(client, label);
            const allPositions = [];

            // For each TradeLayer address, get contract positions
            for (const address of addresses) {
                const contractPositions = await this.getContractPositionsForAddress(address);
                if (contractPositions.length > 0) {
                    allPositions.push({ address, contractPositions });
                }
            }

            return allPositions;
        } catch (error) {
            console.error('Error getting contract positions for TradeLayer addresses:', error);
            throw error;
        }
    }

    /**
     * Retrieves contract positions for a specific address from MarginMaps.
     */
    async getContractPositionsForAddress(address) {
        const MarginMap = require('../src/marginMap.js'); // Replace with your MarginMap module
        const ContractsRegistry = require('../src/contractRegistry.js'); // Replace with your ContractsRegistry module
        const positions = [];

        // Fetch margin map for the address
        const marginMap = await MarginMap.getMarginMapForAddress(address);

        // Check for valid margin map
        if (!marginMap) {
            console.log(`No margin map found for address: ${address}`);
            return positions;
        }

        // Iterate over contracts in the margin map
        for (const [contractId, positionData] of Object.entries(marginMap.contracts)) {
            const contractInfo = await ContractsRegistry.getContractInfo(contractId);
            if (contractInfo) {
                positions.push({
                    contractId: contractId,
                    positionSize: positionData.size,
                    avgEntryPrice: positionData.avgEntryPrice,
                    // Include other relevant contract position details
                });
            }
        }

        return positions;
    }

async getContractPositionForAddressAndContractId(address, contractId) {
    const MarginMap = require('../src/marginMap.js'); // Replace with your MarginMap module
    const ContractsRegistry = require('../src/contractRegistry.js'); // Replace with your ContractsRegistry module
    
    // Fetch margin map for the address
    const marginMap = await MarginMap.getMarginMapForAddress(address);

    // Check for valid margin map
    if (!marginMap) {
        console.log(`No margin map found for address: ${address}`);
        return null;
    }

    // Check if the address has a position for the specified contract
    const positionData = marginMap.contracts[contractId];
    if (!positionData) {
        console.log(`No position data found for contract ID: ${contractId} at address: ${address}`);
        return null;
    }

    const contractInfo = await ContractsRegistry.getContractInfo(contractId);
    if (!contractInfo) {
        console.log(`No contract info found for contract ID: ${contractId}`);
        return null;
    }

    // Return contract position details
    return {
        contractId: contractId,
        positionSize: positionData.size,
        avgEntryPrice: positionData.avgEntryPrice,
        // Include other relevant contract position details
    };
}

    async getStateSnapshot(label = 'TL') {
        const [walletBalances, positions] = await Promise.all([
            this.getAllWalletBalances(label),
            this.getPositions(label),
        ]);

        return {
            label,
            updatedAt: Date.now(),
            walletBalances,
            positions,
            walletBalanceCount: Array.isArray(walletBalances) ? walletBalances.length : 0,
            positionCount: Array.isArray(positions) ? positions.length : 0,
        };
    }

}

module.exports = WalletCache;
