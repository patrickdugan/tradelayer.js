const PM = require('../property')

describe('=== PM TEST ===', () => {
    path = './dbp'
    pm = null

    beforeAll(async () => {
        //console.log('--beforeAll');
    })

    beforeEach(async () => {
        //console.log('--beforeEach');
        pm = new PM(path)
        await pm.load()
    });

    test('== PM PUT ==', async () => {
        if (!pm.isPropertyIdValid(1)) {
            pm.addProperty(1, 'PROP1', 1000000, 'Fixed')
        }
        if (!pm.isPropertyIdValid(2)) {
            pm.addProperty(2, 'PROP2', 500000, 'Managed')
        }
        await pm.save()
    })

    test('== PM ID1 ==', async () => {
        p1 = pm.getPropertyData(1)
        expect(p1 != null).toBe(true)
        expect(p1.ticker).toBe('PROP1')
        expect(p1.type).toBe(1)
        expect(p1.totalInCirculation).toBe(1000000)
    })

    test('== PM ID2 ==', async () => {
        p1 = pm.getPropertyData(2)
        expect(p1 != null).toBe(true)
        expect(p1.ticker).toBe('PROP2')
        expect(p1.type).toBe(2)
        expect(p1.totalInCirculation).toBe(500000)
    })
    
    afterEach(async () => {
        //console.log('--afterEach');
        await pm.close()
    })

    afterAll(async () => {
        //console.log('--afterAll');
    })
})
