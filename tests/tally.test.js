const T = require('../tally3')

describe('=== TALLY TEST ===', () => {
    path = './dbt'
    tally = null

    // beforeAll(async () => {
    //     //console.log('--beforeAll');
    // })

    beforeEach(async () => {
        console.log('--beforeEach');
        tally = new T(path)
        await tally.load()
    });

    test('==T PUT ==', () => {
        tally.updateBalance('a1', 1, 100, 0);
    })

    test('== T GET ==', () => {
        expect(tally.getBalance('a1')).toBe(100)
    })

    afterEach(async () => {
        //console.log('--afterEach');
        await tally.save()
        await tally.close()
    })

    // afterAll(async () => {
    //     //console.log('--afterAll');
    // })
})
