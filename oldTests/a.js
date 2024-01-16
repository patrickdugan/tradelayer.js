const { propertyList } = require('../property.js')
const { contractRegistry } = require('../contractRegistry.js')
const { oracleList } = require('../oracle.js')
const { tallyMap } = require('../tally.js')

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
    
}

(async() => {
    await delay(500)
    console.log(`p:${propertyList.getNextId()} c:${contractRegistry._getNextId()} o:${oracleList.getNextId()}`)
})()