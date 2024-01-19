const { propertyList: pl } = require('../property.js')
const { contractRegistry } = require('../contractRegistry.js')
const { oracleList } = require('../oracle.js')
const { tallyMap } = require('../tally.js')
const { tradeHistory } = require('../tradeHistory.js')

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

(async () => {
    await delay(500)
    console.log(`p:${pl.getNextId()} c:${contractRegistry._getNextId()} o:${oracleList.getNextId()}`)
})()

