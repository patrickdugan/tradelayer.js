// Assuming the LevelDB database is stored at './path_to_margin_db'
const db = require('./db.js');

class MarginMap {
    constructor(seriesId) {
        this.seriesId = seriesId;
        this.margins = new Map();
    }

    static async getInstance(contractId) {
        // Load the margin map for the given contractId from the database
        // If it doesn't exist, create a new instance
        const marginMap = await MarginMap.loadMarginMap(contractId);
        return marginMap;
    }

    initMargin(address, contracts, price) {
        const notional = contracts * price;
        const margin = notional * 0.1;

        this.margins.set(address, {
            contracts,
            margin,
            unrealizedPl: 0
        });

        return margin;
    }

// Set initial margin for a new position in the MarginMap
    async setInitialMargin(sender, contractId, totalInitialMargin) {
        console.log('setting initial margin '+sender, contractId, totalInitialMargin)
        // Check if there is an existing position for the sender
        let position = this.margins.get(sender);

        console.log('position '+JSON.stringify(position))

        if (!position) {
            // If no existing position, initialize a new one
            position = {
                contracts: 0,  // Number of contracts the sender has
                margin: 0      // Total margin amount the sender has posted
            };
        }

        // Update the margin for the existing or new position
        position.margin += totalInitialMargin;

        // Update the MarginMap with the modified position
        this.margins.set(sender, position);
        console.log('margin should be topped up '+JSON.stringify(this.margins))

        // Save changes to the database or your storage solution
        await this.saveMarginMap();
    }

    updateMargin(contractId, sender, contractAmount, totalInitialMargin) {
        const pos = this.margins.get(address);

        if (!pos) {
            return this.initMargin(address, newContracts, price);
        }

        const newNotional = newContracts * price;
        const oldNotional = pos.contracts * price;

        const addedMargin = Math.abs(newNotional - oldNotional) * 0.1;

        pos.contracts = newContracts;
        pos.margin += addedMargin;

        return addedMargin;
    }

    // Update the margin for a specific address and contract
    async updateMargin(contractId, address, amount, price, isBuyOrder) {
            const position = this.margins.get(address) || this.initMargin(address, 0, price);

            // Calculate the required margin for the new amount
            const requiredMargin = this.calculateMarginRequirement(amount, price);

            if (isBuyOrder) {
                // For buy orders, increase contracts and adjust margin
                position.contracts += amount;
                position.margin += requiredMargin;

                // Check for margin maintenance and realize PnL if needed
                this.checkMarginMaintenance(address, contractId);
            } else {
                // For sell orders, decrease contracts and adjust margin
                position.contracts -= amount;
                position.margin -= requiredMargin;

                // Realize PnL if the position is being reduced
                this.realizePnL(address, contractId, amount, price);
            }

            // Ensure the margin doesn't go below zero
            position.margin = Math.max(0, position.margin);

            // Update the margin map
            this.margins.set(address, position);

            // Additional logic to handle margin calls or other adjustments if required
    }

    updateContractBalances(address, amount, price, isBuyOrder) {
        const position = this.margins.get(address) || this.initMargin(address, 0, price);

        // For buy orders, increase contracts and adjust margin
        if (isBuyOrder) {
            position.contracts += amount;
            const additionalMargin = this.calculateMarginRequirement(amount, price);
            position.margin += additionalMargin;
        }
        // For sell orders, decrease contracts and adjust margin
        else {
            position.contracts -= amount;
            const reducedMargin = this.calculateMarginRequirement(amount, price);
            position.margin -= reducedMargin;
        }

        // Ensure the margin doesn't go below zero
        position.margin = Math.max(0, position.margin);

        // Update the margin map
        this.margins.set(address, position);
    }

    calculateMarginRequirement(contracts, price) {
        // Calculate the margin requirement for a given number of contracts at a specific price
        const notional = contracts * price;
        return notional * 0.1; // Example: 10% of the notional value
    }

    realizePnl(address, contracts, price, avgPrice, isInverse, notionalValue) {
        const pos = this.margins.get(address);

        if (!pos) return 0;

        let pnl;
        if (isInverse) {
            // For inverse contracts: PnL = (1/entryPrice - 1/exitPrice) * contracts * notional
            pnl = (1 / avgPrice - 1 / price) * contracts * notionalValue;
        } else {
            // For linear contracts: PnL = (exitPrice - entryPrice) * contracts * notional
            pnl = (price - avgPrice) * contracts * notionalValue;
        }

        pos.margin -= Math.abs(pnl);
        pos.unrealizedPl += pnl;

        return pnl;
    }

    clear(price, contractId) {
        for (let [address, pos] of this.margins) {
            if (pos.contractId === contractId) {
                let upnl;
                if (pos.isInverse) {
                    // For inverse contracts: UPnL = (1/entryPrice - 1/exitPrice) * contracts * notional
                    upnl = (1 / pos.avgPrice - 1 / price) * pos.contracts * pos.notionalValue;
                } else {
                    // For linear contracts: UPnL = (exitPrice - entryPrice) * contracts * notional
                    upnl = (price - pos.avgPrice) * pos.contracts * pos.notionalValue;
                }

                pos.unrealizedPl = upnl;
            }
        }
    }

  // add save/load methods
    saveMarginMap() {
        const key = JSON.stringify({
            seriesId: this.seriesId
        });

        const value = JSON.stringify([...this.margins]);

        // Retrieve the marginMaps database from your Database instance
        const marginMapsDB = db.getDatabase('marginMaps');

        return new Promise((resolve, reject) => {
            // Perform an upsert operation
            marginMapsDB.updateAsync(
                { _id: key }, // Query: Match document with the specified _id
                { _id: key, value: value }, // Update: Document to be inserted or updated
                { upsert: true } // Options: Perform an insert if document doesn't exist
            )
            .then(() => resolve())
            .catch(err => reject(err));
        });
    }


    static async loadMarginMap(seriesId) {
        const key = JSON.stringify({ seriesId});

        // Retrieve the marginMaps database from your Database instance
        const marginMapsDB = db.getDatabase('marginMaps');

        try {
            const doc = await marginMapsDB.findOneAsync({ _id: key });
            if (!doc) {
                // Return a new instance if not found
                return new MarginMap(seriesId);
            }

            const map = new MarginMap(seriesId);
            map.margins = new Map(JSON.parse(doc.value));
            return map;
        } catch (err) {
            if (err.type === 'NotFoundError') {
                return new MarginMap(seriesId); // Return a new instance if not found
            }
            throw err;
        }
    }


    async triggerLiquidations(contract) {
        // Logic to handle the liquidation process
        // This could involve creating liquidation orders and updating the contract's state

        // Example:
        const liquidationOrders = this.generateLiquidationOrders(contract);
        await this.saveLiquidationOrders(contract, liquidationOrders);

        // Update the contract's state as needed
        // Example: contract.state = 'liquidating';
        await ContractsRegistry.updateContractState(contract);

        return liquidationOrders;
    }

    generateLiquidationOrders(contract) {
        const liquidationOrders = [];
        const maintenanceMarginFactor = 0.05; // 5% for maintenance margin

        for (const [address, position] of Object.entries(this.margins[contract.id])) {
            const notionalValue = position.contracts * contract.marketPrice;
            const maintenanceMargin = notionalValue * maintenanceMarginFactor;

            if (position.margin < maintenanceMargin) {
                // Liquidate 50% of the position if below maintenance margin
                const liquidationSize = position.contracts * 0.5;
                liquidationOrders.push({
                    address,
                    contractId: contract.id,
                    size: liquidationSize,
                    price: contract.marketPrice, // Assuming market price for simplicity
                    type: 'liquidation'
                });
            }
        }

        return liquidationOrders;
    }

    static async saveLiquidationOrders(contract, orders, blockHeight) {
        try {
            // Access the marginMaps database
            const marginMapsDB = db.getDatabase('marginMaps');

            // Construct the key and value for storing the liquidation orders
            const key = `liquidationOrders-${contract.id}-${blockHeight}`;
            const value = { _id: key, orders: orders, blockHeight: blockHeight };

            // Save the liquidation orders in the marginMaps database
            await marginMapsDB.insertAsync(value);
        } catch (error) {
            console.error(`Error saving liquidation orders for contract ${contract.id} at block height ${blockHeight}:`, error);
            throw error;
        }
    }

    needsLiquidation(contract) {
        const maintenanceMarginFactor = 0.05; // Maintenance margin is 5% of the notional value

        for (const [address, position] of Object.entries(this.margins[contract.id])) {
            const notionalValue = position.contracts * contract.marketPrice;
            const maintenanceMargin = notionalValue * maintenanceMarginFactor;

            if (position.margin < maintenanceMargin) {
                return true; // Needs liquidation
            }
        }
        return false; // No positions require liquidation
    }

    getMarginLevel(contract) {
        // Assuming margins are stored per position in the contract
        // Example: Return the margin level for the contract
        let totalMargin = 0;
        for (const position of Object.values(this.margins[contract.id])) {
            totalMargin += position.margin;
        }
        return totalMargin;
    }

     // Get the position for a specific address
      async getPositionForAddress(address, contractId) {
        let position = this.margins.get(address);

        // If the position is not found or margins map is empty, try loading from the database
        if (!position || this.margins.size === 0) {
            await MarginMap.loadMarginMap(contractId);
            position = this.margins.get(address);
        }

        // If still not found, return a default position
        if (!position) {
            return {
                contracts: 0,
                margin: 0,
                unrealizedPl: 0,
                // Add other relevant fields if necessary
            };
        }

        return position;
    }

    async getMarketPrice(contract) {
        let marketPrice;

        if (ContractsRegistry.isOracleContract(contract.id)) {
            // Fetch the 3-block TWAP for oracle-based contracts
            marketPrice = await Oracles.getTwap(contract.id, 3); // Assuming the getTwap method accepts block count as an argument
        } else if (ContractsRegistry.isNativeContract(contract.id)) {
            // Fetch VWAP data for native contracts
            const contractInfo = ContractsRegistry.getContractInfo(contract.id);
            if (contractInfo && contractInfo.indexPair) {
                const [propertyId1, propertyId2] = contractInfo.indexPair;
                marketPrice = await VolumeIndex.getVwapData(propertyId1, propertyId2);
            }
        } else {
            throw new Error(`Unknown contract type for contract ID: ${contract.id}`);
        }

        return marketPrice;
    }

}

module.exports = MarginMap