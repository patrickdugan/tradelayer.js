// Assuming the LevelDB database is stored at './path_to_margin_db'
const db = require('./db.js');
const BigNumber = require('bignumber.js')

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

    /*initMargin(address, contracts, price) {
        const notional = contracts * price;
        const margin = notional * 0.1;

        this.margins.set(address, {
            contracts,
            margin,
            unrealizedPl: 0
        });

        return margin;
    }*/

// Set initial margin for a new position in the MarginMap
    async setInitialMargin(sender, contractId, totalInitialMargin) {
        console.log('setting initial margin '+sender, contractId, totalInitialMargin)
        // Check if there is an existing position for the sender
        let position = this.margins.get(sender);

        console.log('setting initial margin position '+JSON.stringify(position))

        if (!position) {
            // If no existing position, initialize a new one
            position = {
                contracts: 0,  // Number of contracts the sender has
                margin: 0      // Total margin amount the sender has posted
            };
        }

        console.log('margin before '+position.margin)
        // Update the margin for the existing or new position
        position.margin += totalInitialMargin;
        console.log('margin after '+position.margin)
        // Update the MarginMap with the modified position
        this.margins.set(sender, position);
        console.log('margin should be topped up '+JSON.stringify(this.margins))

        // Save changes to the database or your storage solution
        await this.saveMarginMap();
    }

    // Update the margin for a specific address and contract
    /*async updateMargin(contractId, address, amount, price, isBuyOrder, inverse) {
            const position = this.margins.get(address) || this.initMargin(address, 0, price);

            // Calculate the required margin for the new amount
            console.log('checking requiredMargin in updateMargin '+JSON.stringify(position)+' amount '+amount +' price '+ price + ' inverse '+inverse)
            const requiredMargin = this.calculateMarginRequirement(amount, price, inverse);

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
    }*/

    async updateContractBalancesWithMatch(match, channelTrade) {
        await this.updateContractBalances(
            match.buyOrder.buyerAddress,
            match.buyOrder.amount,
            match.buyOrder.price,
            true,
            match.buyerPosition,
            match.inverse,
            channelTrade
        );

        await this.updateContractBalances(
            match.sellOrder.sellerAddress,
            match.sellOrder.amount,
            match.sellOrder.price,
            false,
            match.sellerPosition,
            match.inverse,
            channelTrade
        );
    }

    async updateContractBalances(address, amount, price, isBuyOrder,position, inverse, channelTrade) {
        //const position = this.margins.get(address) || this.initMargin(address, 0, price);
        console.log('updating the above position for amount '+JSON.stringify(position) + ' '+amount + ' price ' +price +' address '+address+' is buy '+isBuyOrder)
        // For buy orders, increase contracts and adjust margin
        // Calculate the new position size and margin adjustment
        let newPositionSize = isBuyOrder ? position.contracts + amount : position.contracts - amount;
        console.log('new newPositionSize '+newPositionSize + ' address '+ address + ' amount '+ amount + ' isBuyOrder '+isBuyOrder)
        position.contracts=newPositionSize
        console.log('position now ' + JSON.stringify(position.contracts))

        this.margins.set(address, position);
        await this.saveMarginMap();
    }

    
    calculateMarginRequirement(contracts, price, inverse) {
        
        // Ensure that the input values are BigNumber instances
        let bnContracts = new BigNumber(contracts);
        let bnPrice = new BigNumber(price);

        let notional

        // Calculate the notional value
         if (inverse === true) {
            // For inverse contracts, the notional value is typically the number of contracts divided by the price
            notional = bnContracts.dividedBy(bnPrice);
        } else {
            // For regular contracts, the notional value is the number of contracts multiplied by the price
            notional = bnContracts.multipliedBy(bnPrice);
        }

        // Return 10% of the notional value as the margin requirement
        return notional.multipliedBy(0.1).toNumber();
    }

     /**
     * Checks whether the margin of a given position is below the maintenance margin.
     * If so, it could trigger liquidations or other necessary actions.
     * @param {string} address - The address of the position holder.
     * @param {string} contractId - The ID of the contract.
     */
    checkMarginMaintenance(address, contractId) {
        let position = this.margins.get(address);

        if (!position) {
            console.error(`No position found for address ${address}`);
            return;
        }

        // Calculate the maintenance margin, which is half of the initial margin
        let initialMargin = this.initMargin(position.contracts, position.initialPrice);
        let maintenanceMargin = initialMargin / 2;

        if (position.margin < maintenanceMargin) {
            console.log(`Margin below maintenance level for address ${address}. Initiating liquidation process.`);
            // Trigger liquidation or other necessary actions here
            // Example: this.triggerLiquidation(address, contractId);
        } else {
            console.log(`Margin level is adequate for address ${address}.`);
        }
    }

    async reduceMargin(address, contracts, pnl) {
        const pos = this.margins.get(address);

        if (!pos) return { netMargin: 0, mode: 'none' };

        // Calculate the initial margin for the position
        const initialMargin = this.calculateInitialMargin(pos.size, pos.avgPrice);

        // Calculate the maintenance margin for the position
        const maintMargin = this.calculateMaintenanceMargin(pos.size, pos.avgPrice);

        // Calculate the remaining margin after considering pnl
        const remainingMargin = pos.margin - pnl;

        // Determine the mode based on different scenarios
        let mode;
        if (remainingMargin >= initialMargin) {
            mode = 'profit';
        } else if (remainingMargin >= 0) {
            mode = 'fractionalProfit';
        } else if (remainingMargin >= maintMargin) {
            mode = 'moreThanMaint';
        } else if (remainingMargin > 0) {
            mode = 'lessThanMaint';
        } else if (remainingMargin === 0) {
            mode = 'maint';
        } else {
            // Handle cases where pnl is negative and insufficient margin is available
            // You may need to implement additional logic to cover insurance fund, system tab, etc.
            // ...
            mode = 'insufficientMargin';
        }

        // Check if the margin is below maintenance level
        this.checkMarginMaintenance(address, pos.contractId);

        // Get the margin level for the contract
        const totalMargin = this.getMarginLevel(pos.contractId);

        // Calculate the required margin for the new amount
        const requiredMargin = this.calculateMarginRequirement(contracts, pos.avgPrice, pos.isInverse);

        // Liberating margin on a pro-rata basis
        const netMargin = this.liberateMargin(address, contracts, pnl, mode);

        return { netMargin, mode, totalMargin, requiredMargin };
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

    async settlePNL(address, contracts, price, LIFO, contractId, currentBlockHeight) {
            const pos = this.margins.get(address);

            if (!pos) return 0;

            // Check if the contract is associated with an oracle
            const isOracleContract = await ContractRegistry.isOracleContract(contractId);

            let oraclePrice;
            if (isOracleContract) {
                // Retrieve the oracle ID associated with the contract
                const oracleId = await ContractRegistry.getOracleId(contractId);

                // Retrieve the latest oracle data for the previous block
                oraclePrice = await ContractRegistry.getLatestOracleData(oracleId, currentBlockHeight - 1);
            }

            // Use settlement price based on the oracle data or LIFO Avg. Entry
            const settlementPrice = oraclePrice || LIFO.AvgEntry;

            // Calculate PnL based on settlement price
            const pnl = (price - settlementPrice) * contracts;

            // Update margin and unrealized PnL
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
        console.log('loading margin map for '+seriesId)
        // Retrieve the marginMaps database from your Database instance
        const marginMapsDB = db.getDatabase('marginMaps');

        try {
            const doc = await marginMapsDB.findOneAsync({ _id: key });
            if (!doc) {
                // Return a new instance if not found
                console.log('no MarginMap found, spinning up a fresh one')
                return new MarginMap(seriesId);
            }

            var map = new MarginMap(seriesId);
            map.margins = new Map(JSON.parse(doc.value));
            console.log('returning a map from the file '+JSON.stringify(map))
            return map;
        } catch (err) {
            console.log('err loading margin Map '+err)
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
        console.log('loading position for address '+address +' contract '+contractId + ' ' +JSON.stringify(position) )
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