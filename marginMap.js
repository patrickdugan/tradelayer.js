const BigNumber = require('bignumber.js')
const { dbFactory } = require('./db.js')
const { contractRegistry } = require('./contractRegistry.js')
const { oracleList } = require('./oracle.js')
const { volumeIndex } = require('./volumeIndex.js')

class MarginMap {
    static Empty = {
        contracts: 0,
        margin: 0,
        unrealizedPl: 0,
    }

    constructor(seriesId) {
        this.seriesId = seriesId;
        this.margins = new Map()
    }

    static async load(seriesId) {
        const key = JSON.stringify({ seriesId: seriesId })

        try {
            const data = await dbFactory.getDatabase('marginMaps').findOneAsync({ _id: key })
            const map = new MarginMap(seriesId)
            map.margins = new Map(data?.value)
            let d = [...map.margins.entries()].map(e => `{${e[0]}:[${e[1].contracts}, ${e[1].margin}]}`)
            console.log(`Loaded margins for {seriesId:${seriesId}}: ${d}`)
            return map
        } catch (err) {
            console.log('Error loading margin map: ' + err)
        }
    }

    async save(blockHeight) {
        const key = JSON.stringify({ seriesId: this.seriesId })
        const value = [...this.margins]

        await dbFactory.getDatabase('marginMaps').updateAsync(
            { _id: key }, // Query: Match document with the specified _id
            { _id: key, value: value }, // Update: Document to be inserted or updated
            { upsert: true }) // Options: Perform an insert if document doesn't exist
    }

    initMargin(address, contracts, price) {
        const notional = contracts * price;
        const margin = notional * 0.1;
        let pos = { ...MarginMap.Empty }
        pos.contracts = contracts
        pos.margin = margin
        this.margins.set(address, pos)
        return pos
    }

    // Set initial margin for a new position in the MarginMap
    async setInitialMargin(sender, contractId, totalInitialMargin) {
        console.log('setting initial margin ' + sender, contractId, totalInitialMargin)
        // Check if there is an existing position for the sender
        let position = this.margins.get(sender)

        console.log('setting initial margin position ' + JSON.stringify(position))

        if (!position) {
            // If no existing position, initialize a new one
            position = {
                contracts: 0,  // Number of contracts the sender has
                margin: 0      // Total margin amount the sender has posted
            };
        }

        console.log('margin before ' + position.margin)
        // Update the margin for the existing or new position
        position.margin += totalInitialMargin;
        console.log('margin after ' + position.margin)
        // Update the MarginMap with the modified position
        this.margins.set(sender, position)
        console.log('margin should be topped up ' + JSON.stringify(this.margins))

        // Save changes to the database or your storage solution
        await this.save()
        return position
    }

    async updateContractBalancesWithMatch(match, channelTrade) {
        console.log('updating contract balances, buyer ' + JSON.stringify(match.buyerPosition) + '  and seller ' + JSON.stringify(match.sellerPosition))
        let buyerPosition = await this.updateContractBalances(
            match.buyOrder.buyerAddress,
            match.buyOrder.amount,
            match.buyOrder.price,
            true,
            match.buyerPosition,
            match.inverse,
            channelTrade
        )

        let sellerPosition = await this.updateContractBalances(
            match.sellOrder.sellerAddress,
            match.sellOrder.amount,
            match.sellOrder.price,
            false,
            match.sellerPosition,
            match.inverse,
            channelTrade
        )
        return { bp: buyerPosition, sp: sellerPosition }
    }

    async updateContractBalances(address, amount, price, isBuyOrder, position, inverse, channelTrade) {
        //const position = this.margins.get(address) || this.initMargin(address, 0, price)
        console.log('updating the above position for amount ' + JSON.stringify(position) + ' ' + amount + ' price ' + price + ' address ' + address + ' is buy ' + isBuyOrder)
        // For buy orders, increase contracts and adjust margin
        // Calculate the new position size and margin adjustment
        let newPositionSize = isBuyOrder ? position.contracts + amount : position.contracts - amount;
        console.log('new newPositionSize ' + newPositionSize + ' address ' + address + ' amount ' + amount + ' isBuyOrder ' + isBuyOrder)
        position.contracts = newPositionSize
        console.log('position now ' + JSON.stringify(position))

        this.margins.set(address, position)
        return position
        //await this.saveMarginMap()
    }

    calculateMarginRequirement(contracts, price, inverse) {

        // Ensure that the input values are BigNumber instances
        let bnContracts = new BigNumber(contracts)
        let bnPrice = new BigNumber(price)

        let notional

        // Calculate the notional value
        if (inverse === true) {
            // For inverse contracts, the notional value in denominator collateral is typically the number of contracts divided by the price
            notional = bnContracts.dividedBy(bnPrice)
        } else {
            // For regular contracts, the notional value is the number of contracts multiplied by the price
            notional = bnContracts.multipliedBy(bnPrice)
        }

        // Return 10% of the notional value as the margin requirement
        return notional.multipliedBy(0.1).toNumber()
    }

    /**
    * Checks whether the margin of a given position is below the maintenance margin.
    * If so, it could trigger liquidations or other necessary actions.
    * @param {string} address - The address of the position holder.
    * @param {string} contractId - The ID of the contract.
    */
    checkMarginMaintenance(address, contractId) {
        let position = this.margins.get(address)

        if (!position) {
            console.error(`No position found for address ${address}`)
            return;
        }

        const ContractRegistry = require('./contractRegistry.js')
        // Calculate the maintenance margin, which is half of the initial margin
        let initialMargin = ContractRegistry.getInitialMargin(contractId)
        let maintenanceMargin = (position.contracts * initialMargin) / 2;

        if (position.margin < maintenanceMargin) {
            console.log(`Margin below maintenance level for address ${address}. Initiating liquidation process.`)
            // Trigger liquidation or other necessary actions here
            // Example: this.triggerLiquidation(address, contractId)
        } else {
            console.log(`Margin level is adequate for address ${address}.`)
        }
    }

    async reduceMargin(pos, contracts, pnl, isInverse, contractId, address, avgPrice) {
        //const pos = this.margins.get(address) //this is showing null null for margin and UPNL, let's return to figure out why
        console.log('checking position inside reduceMargin ' + JSON.stringify(pos))

        if (!pos) return { netMargin: 0, mode: 'none' };

        // Calculate the initial margin for the position
        //const initialMargin = this.calculateMarginRequirement(pos.contracts, avgPrice, isInverse)
        let initialMargin = contracts * 0.1
        console.log('initialMargin ' + initialMargin + ' pos margin ' + pos.margin + ' pnl ' + pnl)
        // Calculate the maintenance margin for the position
        const maintMargin = initialMargin / 2

        // Calculate the remaining margin after considering pnl
        const remainingMargin = pos.margin - pnl;
        console.log('inside reduce margin ' + maintMargin + ' ' + remainingMargin)
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
        console.log('mode ' + mode)

        // Check if the margin is below maintenance level
        //this.checkMarginMaintenance(address, pos.contractId)

        // Get the margin level for the contract
        const totalMargin = pos.margin

        // Calculate the required margin for the new amount
        const requiredMargin = this.calculateMarginRequirement(contracts, pos.avgPrice, pos.isInverse)

        // Liberating margin on a pro-rata basis
        const netMargin = this.liberateMargin(pos, totalMargin, contracts, pnl, mode, address)

        return { netMargin, mode, totalMargin, requiredMargin };
    }

    liberateMargin(pos, margin, contracts, pnl, mode, address) {
        //const pos = this.margins.get(address)

        if (!pos) {
            console.error(`No position found for address ${address}`)
            return 0;
        }

        let liberatedMargin = 0;

        switch (mode) {
            case 'profit':
                // Logic for liberating margin in case of profit
                liberatedMargin = this.profitLiberation(pos, contracts, pnl)
                break;
            case 'fractionalProfit':
                // Logic for liberating margin in case of fractional profit
                liberatedMargin = this.fractionalProfitLiberation(pos, contracts, pnl)
                break;
            case 'moreThanMaint':
                // Logic for liberating margin when remaining margin is more than maintenance margin
                liberatedMargin = this.moreThanMaintLiberation(pos, contracts, pnl)
                break;
            case 'lessThanMaint':
                // Logic for liberating margin when remaining margin is less than maintenance margin
                liberatedMargin = this.lessThanMaintLiberation(pos, contracts, pnl)
                break;
            case 'maint':
                // Logic for liberating margin when remaining margin is equal to maintenance margin
                liberatedMargin = this.maintLiberation(pos, contracts, pnl)
                break;
            default:
                console.error(`Invalid mode: ${mode}`)
        }

        // Update the margin map with the liberated margin
        pos.margin -= liberatedMargin;
        this.margins.set(address, pos)

        // Save changes to the database or your storage solution
        //this.saveMarginMap()

        return liberatedMargin;
    }

    profitLiberation(position, contracts, pnl) {
        // Logic for liberating margin in case of profit
        // Example: Liberating a fraction of the profit based on the total profit
        const totalProfit = Math.abs(pnl)
        const liberationFraction = totalProfit > 0 ? contracts * Math.min(1, contracts / totalProfit) : 0;

        return liberationFraction;
    }

    fractionalProfitLiberation(position, contracts, pnl) {
        // Logic for liberating margin in case of fractional profit
        // Example: Liberating a fraction of the profit based on the total profit
        const totalProfit = Math.abs(pnl)
        const liberationFraction = totalProfit > 0 ? contracts * Math.min(1, contracts / totalProfit) : 0;

        return liberationFraction;
    }

    moreThanMaintLiberation(position, contracts, pnl) {
        // Logic for liberating margin when remaining margin is more than maintenance margin
        // Example: Liberating a fixed fraction of the maintenance margin
        const maintenanceMargin = this.calculateMaintenanceMargin(position.size, position.avgPrice)
        const liberationFraction = maintenanceMargin > 0 ? contracts * 0.5 : 0;

        return liberationFraction;
    }

    lessThanMaintLiberation(position, contracts, pnl) {
        // Logic for liberating margin when remaining margin is less than maintenance margin
        // Example: Liberating a fixed fraction of the remaining margin
        const liberationFraction = contracts * 0.2;

        return liberationFraction;
    }

    maintLiberation(position, contracts, pnl) {
        // Logic for liberating margin when remaining margin is equal to maintenance margin
        // Example: Liberating a fixed fraction of the maintenance margin
        const maintenanceMargin = this.calculateMaintenanceMargin(position.size, position.avgPrice)
        const liberationFraction = maintenanceMargin > 0 ? contracts * 0.5 : 0;

        return liberationFraction;
    }


    realizePnl(address, contracts, price, avgPrice, isInverse, notionalValue, pos) {
        if (!pos) {
            return 0
        }

        let pnl;
        console.log('inside realizedPNL ' + address + ' ' + contracts + ' trade price ' + price + ' avg. entry ' + avgPrice + ' is inverse ' + isInverse + ' notional ' + notionalValue + ' position' + JSON.stringify(pos))
        if (isInverse) {
            // For inverse contracts: PnL = (1/entryPrice - 1/exitPrice) * contracts * notional
            pnl = (1 / avgPrice - 1 / price) * contracts * notionalValue
            console.log('pnl ' + pnl)
        } else {
            // For linear contracts: PnL = (exitPrice - entryPrice) * contracts * notional
            pnl = (price - avgPrice) * contracts * notionalValue;
            console.log('pnl ' + (price - avgPrice), contracts, notionalValue, pnl)
        }

        //pos.margin -= Math.abs(pnl)
        //pos.unrealizedPl += pnl; //be sure to modify uPNL and scoop it out for this value...
        console.log('inside realizePnl ' + price + ' price then avgPrice ' + avgPrice + ' contracts ' + contracts + ' notionalValue ' + notionalValue)
        return pnl;
    }

    async settlePNL(address, contracts, price, LIFO, contractId, currentBlockHeight) {
        const pos = this.margins.get(address)
        if (!pos) {
            return 0;
        }

        // Check if the contract is associated with an oracle
        const isOracleContract = await ContractRegistry.isOracleContract(contractId)

        let oraclePrice;
        if (isOracleContract) {
            // Retrieve the oracle ID associated with the contract
            const oracleId = await contractRegistry.getOracleId(contractId)

            // Retrieve the latest oracle data for the previous block
            oraclePrice = await contractRegistry.getLatestOracleData(oracleId, currentBlockHeight - 1)
        }

        // Use settlement price based on the oracle data or LIFO Avg. Entry
        const settlementPrice = oraclePrice || LIFO.AvgEntry;

        // Calculate PnL based on settlement price
        const pnl = (price - settlementPrice) * contracts;

        // Update margin and unrealized PnL
        pos.margin -= Math.abs(pnl)
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

    async triggerLiquidations(contract) {
        // Logic to handle the liquidation process
        // This could involve creating liquidation orders and updating the contract's state

        // Example:
        const liquidationOrders = this.generateLiquidationOrders(contract)
        await this.saveLiquidationOrders(contract, liquidationOrders)

        // Update the contract's state as needed
        // Example: contract.state = 'liquidating';
        await contractRegistry.updateContractState(contract)

        return liquidationOrders;
    }

    generateLiquidationOrders(contract) {
        const liquidationOrders = [];
        const maintenanceMarginFactor = 0.05; // 5% for maintenance margin
        // TODO: fixme
        // for (const [address, position] of Object.entries(this.margins[contract.id])) {
        //     const notionalValue = position.contracts * contract.marketPrice;
        //     const maintenanceMargin = notionalValue * maintenanceMarginFactor;

        //     if (position.margin < maintenanceMargin) {
        //         // Liquidate 50% of the position if below maintenance margin
        //         const liquidationSize = position.contracts * 0.5;
        //         liquidationOrders.push({
        //             address,
        //             contractId: contract.id,
        //             size: liquidationSize,
        //             price: contract.marketPrice, // Assuming market price for simplicity
        //             type: 'liquidation'
        //         })
        //     }
        // }

        return liquidationOrders;
    }

    async saveLiquidationOrders(contract, orders, blockHeight) {
        try {
            // Construct the key and value for storing the liquidation orders
            const key = `liquidationOrders-${contract.id}-${blockHeight}`;
            const value = { _id: key, orders: orders, blockHeight: blockHeight };

            // Save the liquidation orders in the marginMaps database
            await dbFactory.getDatabase('marginMaps').insertAsync(value)
        } catch (error) {
            console.error(`Error saving liquidation orders for contract ${contract.id} at block height ${blockHeight}:`, error)
            throw error;
        }
    }

    needsLiquidation(contract) {
        // const maintenanceMarginFactor = 0.05; // Maintenance margin is 5% of the notional value
        // TODO: fixme
        // for (const [address, position] of Object.entries(this.margins[contract.id])) {
        //     const notionalValue = position.contracts * contract.marketPrice;
        //     const maintenanceMargin = notionalValue * maintenanceMarginFactor;

        //     if (position.margin < maintenanceMargin) {
        //         return true; // Needs liquidation
        //     }
        // }
        return false; // No positions require liquidation
    }


    // Get the position for a specific address
    async getPositionForAddress(address, contractId) {
        let position = this.margins.get(address)
        console.log('loading position for address ' + address + ' contract ' + contractId + ' ' + JSON.stringify(position))
        // If the position is not found or margins map is empty, try loading from the database
        if (!position || this.margins.length === 0) {
            console.log('going into exception for getting Position ')
            await MarginMap.load(contractId)
            position = this.margins.get(address)
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

        if (contractRegistry.isOracleContract(contract.id)) {
            // Fetch the 3-block TWAP for oracle-based contracts
            marketPrice = await oracleList.getTwap(contract.id, 3) // Assuming the getTwap method accepts block count as an argument
        } else if (contractRegistry.isNativeContract(contract.id)) {
            // Fetch VWAP data for native contracts
            const contractInfo = contractRegistry.getContractInfo(contract.id)
            if (contractInfo && contractInfo.indexPair) {
                const [propertyId1, propertyId2] = contractInfo.indexPair;
                marketPrice = await volumeIndex.getVwapData(propertyId1, propertyId2)
            }
        } else {
            throw new Error(`Unknown contract type for contract ID: ${contract.id}`)
        }

        return marketPrice;
    }
}

module.exports = MarginMap
