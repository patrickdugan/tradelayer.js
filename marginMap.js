// Assuming the LevelDB database is stored at './path_to_margin_db'
const {marginMapDB, contractListDB} = require('./db.js');

class MarginMap {
    constructor(seriesId) {
        this.seriesId = seriesId;
        this.margins = new Map();
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

    updateMargin(address, newContracts, price) {
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


    realizePnl(address, contracts, price, avgPrice) {
        const pos = this.margins.get(address);

        if (!pos) return 0;

        const pnl = (avgPrice - price) * contracts;

        pos.margin -= Math.abs(pnl);
        pos.unrealizedPl += pnl;

        return pnl;
    }

    clear(price) {
        for (let [address, pos] of this.margins) {
            const upnl = (price - pos.avgPrice) * pos.contracts;

            pos.unrealizedPl = upnl;
        }
    }



    // add save/load methods
    saveMarginMap(currentBlockHeight) {
        const key = JSON.stringify({
            seriesId: this.seriesId,
            block: currentBlockHeight
        });

        const value = JSON.stringify([...this.margins]);

        return new Promise((resolve, reject) => {
            db.put(key, value, err => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    static loadMarginMap(seriesId, block) {
        const key = JSON.stringify({ seriesId, block });

        return new Promise((resolve, reject) => {
            db.get(key, (err, value) => {
                if (err) {
                    if (err.type === 'NotFoundError') {
                        resolve(new MarginMap(seriesId)); // Return a new instance if not found
                    } else {
                        return reject(err);
                    }
                }

                const map = new MarginMap(seriesId);
                map.margins = new Map(JSON.parse(value));
                resolve(map);
            });
        });
    }

    static async triggerLiquidations(contract) {
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

    static generateLiquidationOrders(contract) {
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

    static async saveLiquidationOrders(contract, orders) {
        try {
            // Save liquidation orders to the database
            await db.put(`liquidationOrders-${contract.id}`, JSON.stringify(orders));
        } catch (error) {
            console.error(`Error saving liquidation orders for contract ${contract.id}:`, error);
            throw error;
        }
    }

    static needsLiquidation(contract) {
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

    static getMarginLevel(contract) {
        // Assuming margins are stored per position in the contract
        // Example: Return the margin level for the contract
        let totalMargin = 0;
        for (const position of Object.values(this.margins[contract.id])) {
            totalMargin += position.margin;
        }
        return totalMargin;
    }

    static async getMarketPrice(contract) {
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