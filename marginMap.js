const BigNumber = require('bignumber.js')
const { dbFactory } = require('./db.js')

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
        const key = JSON.stringify({ seriesId })
        console.log('loading margin map for ' + seriesId)

        try {
            const data = await dbFactory.getDatabase('marginMaps').findOneAsync({ _id: key })
            const map = new MarginMap(seriesId)
            map.margins = data?.value ? new Map(JSON.parse(data.value)) : new Map()
            return map
        } catch (err) {
            console.log('Error loading margin map: ' + err)
        }
    }

    async save(blockHeight) {
        const key = JSON.stringify({
            seriesId: this.seriesId
        })
        const value = JSON.stringify([...this.margins])

        await dbFactory.getDatabase('marginMaps').updateAsync(
            { _id: key }, // Query: Match document with the specified _id
            { _id: key, value: value }, // Update: Document to be inserted or updated
            { upsert: true }) // Options: Perform an insert if document doesn't exist
    }

    initMargin(address, contracts, price) {
        const notional = contracts * price;
        const margin = notional * 0.1;
        let pos = MarginMap.Empty
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
            position = MarginMap.Empty
        }

        // Update the margin for the existing or new position
        position.margin += totalInitialMargin;

        // Update the MarginMap with the modified position
        this.margins.set(sender, position)
        console.log('margin should be topped up ' + JSON.stringify(this.margins))

        // Save changes to the database or your storage solution
        await this.save()
    }

    // Update the margin for a specific address and contract
    async updateMargin(contractId, address, amount, price, isBuyOrder, inverse) {
        const position = this.margins.get(address) || this.initMargin(address, 0, price)

        // Calculate the required margin for the new amount
        console.log('checking requiredMargin in updateMargin ' + JSON.stringify(position) + ' amount ' + amount + ' price ' + price + ' inverse ' + inverse)
        const requiredMargin = this.calculateMarginRequirement(amount, price, inverse)

        if (isBuyOrder) {
            // For buy orders, increase contracts and adjust margin
            position.contracts += amount;
            position.margin += requiredMargin;

            // Check for margin maintenance and realize PnL if needed
            this.checkMarginMaintenance(address, contractId)
        } else {
            // For sell orders, decrease contracts and adjust margin
            position.contracts -= amount;
            position.margin -= requiredMargin;

            // Realize PnL if the position is being reduced
            this.realizePnl(address, contractId, amount, price)
        }

        // Ensure the margin doesn't go below zero
        position.margin = Math.max(0, position.margin)

        // Update the margin map
        this.margins.set(address, position)

        // Additional logic to handle margin calls or other adjustments if required
    }

    updateContractBalances(address, amount, price, isBuyOrder, position, inverse) {
        //const position = this.margins.get(address) || this.initMargin(address, 0, price)
        console.log('updating the above position for amount ' + JSON.stringify(position) + ' ' + amount + ' price ' + price + ' address ' + address + ' is buy ' + isBuyOrder)
        // For buy orders, increase contracts and adjust margin
        // Calculate the new position size and margin adjustment
        let newPositionSize = isBuyOrder ? position.contracts + amount : position.contracts - amount;
        let marginAdjustment = this.calculateMarginRequirement(Math.abs(amount), price, inverse)

        // Compare the absolute values of the old and new position sizes
        if (Math.abs(newPositionSize) > Math.abs(position.contracts)) {
            // Absolute value of position size has increased
            console.log('Increasing margin by ' + marginAdjustment)
            position.margin += marginAdjustment;
        } else if (Math.abs(newPositionSize) < Math.abs(position.contracts)) {
            // Absolute value of position size has decreased
            console.log('Reducing margin by ' + marginAdjustment)
            position.margin -= marginAdjustment;
        }

        if (position.margin < 0) {
            console.log('warning, negative margin ' + position.margin)
        }
        // Ensure the margin doesn't go below zero 
        position.margin = Math.max(0, position.margin)

        // Update the margin map
        this.margins.set(address, position)
    }

    /**
     * Clears the margin for a specific address and contract based on PnL change.
     * @param {string} contractId - The ID of the contract.
     * @param {string} address - The address of the position holder.
     * @param {number} pnlChange - The change in unrealized profit/loss.
     * @param {boolean} inverse - Whether the contract is inverse.
     */
    clearMargin(contractId, address, pnlChange, inverse) {
        const position = this.margins.get(address);

        if (!position) {
            console.error(`No position found for address ${address}`);
            return;
        }

        // Calculate the change in margin based on PnL
        const marginChange = this.calculateMarginChange(pnlChange, inverse);
        console.log('clearing margin for position in amount ' +JSON.stringify(position) + ' ' +marginChange)
        // Update the margin for the position
        position.margin -= marginChange;

        // Ensure the margin doesn't go below zero
        if(position.margin >0){
            console.log('liquidation wipeout! '+position.margin)
            //need to do some emergency liquidation stuff here
        }
        position.margin = Math.max(0, position.margin);

        // Update the margin map
        this.margins.set(address, position);
        return position
        // Additional logic if needed
    }

    /**
     * Calculates the change in margin based on PnL change.
     * @param {number} pnlChange - The change in unrealized profit/loss.
     * @param {boolean} inverse - Whether the contract is inverse.
     * @returns {number} - The change in margin.
     */
    calculateMarginChange(pnlChange, inverse) {
        // Example calculation, replace with your specific logic
        const marginChange = Math.abs(pnlChange) * (inverse ? 1 : -1);
        console.log('calculated marginChange with inverse? ' +inverse + 'marginChange')
        return marginChange;
    }


    calculateMarginRequirement(contracts, price, inverse) {
        // Ensure that the input values are BigNumber instances
        let bnContracts = new BigNumber(contracts)
        let bnPrice = new BigNumber(price)

        let notional

        // Calculate the notional value
        if (inverse === true) {
            // For inverse contracts, the notional value is typically the number of contracts divided by the price
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

        // Calculate the maintenance margin, which is half of the initial margin
        let initialMargin = this.initMargin(position.contracts, position.initialPrice)
        let maintenanceMargin = initialMargin / 2;

        if (position.margin < maintenanceMargin) {
            console.log(`Margin below maintenance level for address ${address}. Initiating liquidation process.`)
            // Trigger liquidation or other necessary actions here
            // Example: this.triggerLiquidation(address, contractId)
        } else {
            console.log(`Margin level is adequate for address ${address}.`)
        }
    }

    realizePnl(address, contracts, price, avgPrice, isInverse, notionalValue) {
        const pos = this.margins.get(address)

        if (!pos) return 0;

        let pnl;
        if (isInverse) {
            // For inverse contracts: PnL = (1/entryPrice - 1/exitPrice) * contracts * notional
            pnl = (1 / avgPrice - 1 / price) * contracts * notionalValue;
        } else {
            // For linear contracts: PnL = (exitPrice - entryPrice) * contracts * notional
            pnl = (price - avgPrice) * contracts * notionalValue;
        }

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
        // const liquidationOrders = this.generateLiquidationOrders(contract)
        // await this.saveLiquidationOrders(contract, liquidationOrders)

        // // Update the contract's state as needed
        // // Example: contract.state = 'liquidating';
        // await ContractsRegistry.updateContractState(contract)

        // return liquidationOrders;
        return {}
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
                })
            }
        }

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

    async hasOpenPositions() {
        return this.margins.values().findIndex(v => v?.contracts > 0) > -1
    }

    // Get the position for a specific address
    async getPositionForAddress(address, contractId) {
        let pos = this.margins.get(address)
        return pos ? pos : MarginMap.Empty
    }
}

module.exports = MarginMap
