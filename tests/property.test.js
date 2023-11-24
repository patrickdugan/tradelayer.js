const PM = require('../property')

describe('=== PM TEST ===', () => {
    path = './dbPM'
    pm = null

    beforeAll(async () => {
        //console.log('--beforeAll');
    })

    beforeEach(async () => {
        //console.log('--beforeEach');
        pm = new PM(path)
        await pm.load()
    });

    test('PUT1', async () => {
        pm.addProperty(1, 'PROP1', 1000000, 'Fixed')
    })

    test('ID1', async () => {
        let p = pm.getPropertyData(1)
        expect(p != null).toBe(true)
        expect(p.ticker).toBe('PROP1')
        expect(p.type).toBe(1)
        expect(p.totalInCirculation).toBe(1000000)
    })

    test('PUT2', async () => {
        pm.addProperty(2, 'PROP2', 500000, 'Managed')
    })

    test('ID2', async () => {
        let p = pm.getPropertyData(2)
        expect(p != null).toBe(true)
        expect(p.ticker).toBe('PROP2')
        expect(p.type).toBe(2)
        expect(p.totalInCirculation).toBe(500000)
    })

    afterEach(async () => {
        //console.log('--afterEach');
        await pm.save()
        await pm.close()
    })

    afterAll(async () => {
        //console.log('--afterAll');
        pm = new PM(path)
        await pm.save()
        await pm.close()
    })
})
