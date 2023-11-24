const Tally = require('../tally')

describe('=== TALLY TESTS ===', () => {
    path = './dbTL'
    tally = null

    // beforeAll(async () => {
    //     //console.log('--beforeAll');
    // })

    beforeEach(async () => {
        //console.log('--beforeEach');
        tally = new Tally(path)
        await tally.load()
    });

    test('PUT', () => {
        tally.updateBalance('a1', 1, 100, 10, 0);
        tally.updateBalance('a1', 2, 200, 20, 0);
    })

    test('BAL', () => {
        let b1 = tally.getAddressBalances('a1').map(b => b.balance.amount).reduce((a, b) => a + b, 0)
        expect(b1).toBe(300)
        let b2 = tally.getAddressesWithBalanceForProperty(1).map(b => b.amount).reduce((a, b) => a + b, 0)
        expect(b2).toBe(100)
    })

    test('SUM', () => {
        let sum2 = tally.totalTokens(2)
        expect(sum2).toBe(20)
        let sum1 = tally.totalTokens(1)
        expect(sum1).toBe(10)
    })

    afterEach(async () => {
        //console.log('--afterEach');
        await tally.save()
        await tally.close()
    })

    afterAll(async () => {
        //console.log('--afterAll');
        tally = new Tally(path)
        await tally.save()
        await tally.close()
    })
})
