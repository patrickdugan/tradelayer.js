const { propertyList: pl } = require('../property.js')
const { contractRegistry } = require('../contractRegistry.js')
const { oracleList } = require('../oracle.js')
const { tallyMap } = require('../tally.js')
const { txIndex } = require('../txIndex.js')
const { tradeHistory } = require('../tradeHistory.js')
const ContractMargins = require('../marginMap.js')

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

(async () => {
    await delay(500)
    console.log(`p:${pl.getNextId()} c:${contractRegistry._getNextId()} o:${oracleList.getNextId()}, m:${[...(await ContractMargins.getMargins(1)).margins.keys()]}`)
})()
