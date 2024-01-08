const {propertyList} = require('../property.js')

describe('=== PM TEST ===', () => {

    beforeAll(async () => {
        //console.log('--beforeAll');
    })

    beforeEach(async () => {
        //console.log('--beforeEach');
        //await propertyList.load()
    });

    test('PUT1', async () => {
        await propertyList.addProperty(1, 'PROP1', 1000000, 'Fixed')
    })

    test('ID1', () => {
        let p = propertyList.getProperty(1)
        expect(p != null).toBe(true)
        expect(p.ticker).toBe('PROP1')
        expect(p.type).toBe(1)
        expect(p.totalInCirculation).toBe(1000000)
    })

    test('PUT2', async () => {
        await propertyList.addProperty(2, 'PROP2', 500000, 'Managed')
    })

    test('ID2', () => {
        let p = propertyList.getProperty(2)
        expect(p != null).toBe(true)
        expect(p.ticker).toBe('PROP2')
        expect(p.type).toBe(2)
        expect(p.totalInCirculation).toBe(500000)
    })

    afterEach(async () => {
        //console.log('--afterEach');
    })

    afterAll(() => {
        //console.log('--afterAll');
        propertyList.dump()
        propertyList.clear()
        //await pm.save()
    })
})
