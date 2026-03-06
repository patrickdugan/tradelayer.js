describe('Oracle metadata retention on publish', () => {
  function makeInMemoryDb() {
    const stores = new Map();
    const ensure = (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return stores.get(name);
    };
    const match = (doc, query) => Object.entries(query || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && ('$gte' in v || '$lte' in v)) {
        const n = Number(doc[k]);
        if ('$gte' in v && !(n >= Number(v.$gte))) return false;
        if ('$lte' in v && !(n <= Number(v.$lte))) return false;
        return true;
      }
      return doc[k] === v;
    });
    return {
      getDatabase: async (name) => {
        const store = ensure(name);
        return {
          insertAsync: async (doc) => {
            if (store.has(doc._id)) throw new Error('dup');
            store.set(doc._id, { ...doc });
            return doc;
          },
          findOneAsync: async (query) => {
            if (query && query._id) return store.get(query._id) || null;
            for (const doc of store.values()) {
              if (match(doc, query)) return { ...doc };
            }
            return null;
          },
          findAsync: async (query) => {
            const out = [];
            for (const doc of store.values()) {
              if (match(doc, query || {})) out.push({ ...doc });
            }
            return out;
          },
          updateAsync: async (selector, updateDoc, options = {}) => {
            const key = selector && selector._id;
            if (!key) throw new Error('selector _id required');
            if (updateDoc && updateDoc.$set) {
              const prev = store.get(key) || {};
              store.set(key, { ...prev, ...updateDoc.$set, _id: key });
            } else {
              if (!store.has(key) && !options.upsert) return 0;
              store.set(key, { ...updateDoc });
            }
            return 1;
          }
        };
      }
    };
  }

  test('publishData keeps admin/backup fields for later relay validation', async () => {
    jest.resetModules();
    const mockedDb = makeInMemoryDb();
    jest.doMock('../src/db', () => mockedDb);

    const OracleList = require('../src/oracle');
    const oracleId = await OracleList.createOracle({
      ticker: 'TESTORC',
      adminAddress: 'tltc-admin',
      backupAddress: 'tltc-backup',
      lag: 1
    });

    await OracleList.publishData(oracleId, 123.45, 123.45, 123.45, 123.45, 1000);
    const oracle = await OracleList.getOracleInfo(oracleId);

    expect(oracle.adminAddress).toBe('tltc-admin');
    expect(oracle.backupAddress).toBe('tltc-backup');
    expect(Number(oracle.data.price)).toBeCloseTo(123.45);
  });
});
