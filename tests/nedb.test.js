const util = require('util');
const DB = require('nedb');

describe('=== NEDB TESTs ===', () => {
    path = './dbNE'
    db = null

    beforeAll(async () => {
        //console.log('--beforeAll');
    })

    beforeEach(async () => {
        //console.log('--beforeEach');
        db = new DB({ filename: path, autoload: true });
        db.findAsync = util.promisify(db.find.bind(db));
        db.insertAsync = util.promisify(db.insert.bind(db));
        db.removeAsync = util.promisify(db.remove.bind(db));
        db.updateAsync = util.promisify(db.update.bind(db));
        db.findOneAsync = util.promisify(db.findOne.bind(db));
        db.countAsync = util.promisify(db.count.bind(db));
        //db.loadDatabase();
        //console.log(db.getAllData());
    });

    test('PUT', async () => {
        await db.updateAsync({_id:1},{_id:1,'value':0},{'upsert': true})
    })

    test('GET', async () => {
        v = await db.findOneAsync({_id:1});
        expect(v['_id']).toBe(1)
        expect(v['value']).toBe(0)
    })

    afterEach(async () => {
        //console.log('--afterEach');
        //await or.save()
        //await or.close()
    })

    afterAll(async () => {
        //console.log('--afterAll');
    })
})