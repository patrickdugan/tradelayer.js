const OB = require('../orderbook')

describe('=== OB TESTS ===', () => {
    path = './dbOB'
    ob = null

    beforeAll(async () => {
        //console.log('--beforeAll');
    })

    beforeEach(async () => {
        //console.log('--beforeEach');
        ob = new OB(path)
        await ob.load()
    });

    test('PUT', async () => {
        ob.addTokenOrder({ propertyIdNumber : 1, propertyIdNumberDesired : 1, amountOffered : 100, amountExpected : 100, time : 123456789 })
    })

    test('GET', async () => {
    })

    afterEach(async () => {
        //console.log('--afterEach');
        //await ob.save(null)
        await ob.close()
    })

    afterAll(async () => {
        //console.log('--afterAll');
        ob = new OB(path)
        await ob.clear()
        await ob.close()
    })
})
