const OR = require('../oracle')

describe('=== ORACLE TESTs ===', () => {
    path = './dbOR'
    or = null

    beforeAll(async () => {
        //console.log('--beforeAll');
    })

    beforeEach(async () => {
        //console.log('--beforeEach');
        or = new OR(path)
        await or.load()
    });

    test('PUT', async () => {
    })

    test('GET', async () => {
    })

    afterEach(async () => {
        //console.log('--afterEach');
        //await or.save()
        await or.close()
    })

    afterAll(async () => {
        //console.log('--afterAll');
    })
})
