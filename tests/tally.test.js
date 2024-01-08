const { tallyMap } = require('../tally.js');

describe('=== TALLY TESTs ===', function () {
    const a1 = 'a1';
    const pid = 1;

    beforeAll(async () => {
        //console.log('--beforeAll');
    })

    beforeEach(async () => {
        //console.log('--beforeEach');
        await tallyMap.loadTally()
    });

    test('PUT', async () => {
        await tallyMap.updateBalance(a1, pid, 100, 80, 20, 0)
    })

    test('GET', async () => {
        const e = tallyMap.getAddressBalances(a1)
        expect(e.length).toBe(1)
        expect(e[0].propertyId).toBe(pid.toString())
        expect(e[0].balance.amount).toBe(100)
        expect(e[0].balance.available).toBe(80)
        expect(e[0].balance.reserved).toBe(20)
    })

    test('NEG', async () => {
        await expect(async () => {
            await tallyMap.updateBalance('a2', 2, -100, -50, -50, 0)
        })
        .rejects
        .toThrow('Available balance cannot go negative')
    })

    test('TOT', () => {
        const total = tallyMap.totalTokens(1)
        expect(total).toBe(100) // Total from previous test
    })

    afterAll(async () => {
        //console.log('--afterAll');
    })

    // Additional tests for save, load, getTally, etc.
})
