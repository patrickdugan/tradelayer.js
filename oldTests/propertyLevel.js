// PropertyManager

const level = require('level');
const db = level('properties');

// ...existing code

loadPropertyIndexFromDb() {
  return new Promise((resolve, reject) => {
    db.get('propertyIndex', (err, value) => {
      if (err) return reject(err);
      if (!value) return resolve();
      
      this.propertyIndex = new Map(Object.entries(JSON.parse(value)));
      resolve();
    });
  });
}

savePropertyIndexToDb() {
  const indexJson = JSON.stringify(Object.fromEntries(this.propertyIndex));
  
  return new Promise((resolve, reject) => {
    db.put('propertyIndex', indexJson, err => {
      if (err) return reject(err);
      resolve();
    }); 
  });
}

// TallyMap

const db = level('balances');

// ...existing code 

loadBalancesFromDb() {
  return new Promise((resolve, reject) => {
    db.createReadStream()
      .on('data', ({key, value}) => {
        const { address, propertyId } = JSON.parse(key);
        const balance = JSON.parse(value);
        
        this.updateBalance(
          address, 
          propertyId,
          balance.amount,
          balance.available,
          balance.reserved
        );
      })
      .on('error', reject)
      .on('end', resolve);
  });
}

saveBalancesToDb() {
  const batch = [];
  
  for (let [address, balances] of this.addresses) {
    for (let [propertyId, balance] of Object.entries(balances)) {
      const key = JSON.stringify({ address, propertyId });
      const value = JSON.stringify(balance);
      
      batch.push({ type: 'put', key, value });
    }
  }
  
  return new Promise((resolve, reject) => {
    db.batch(batch, err => {
      if (err) return reject(err);
      resolve();
    });
  });
}