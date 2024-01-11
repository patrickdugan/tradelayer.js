const Properties = require('../property.js'); // Adjust the path to the PropertyManager class file

async function addRandomTokensAndDisplay(count) {
    const propertyManager = PropertyManager.getInstance();
    const propertyTypes = ['Fixed', 'Managed', 'Native', 'Vesting', 'Synthetic', 'Non-Fungible'];
    

    for (let i = 0; i < count; i++) {
        const ticker = 'TK' + Math.random().toString(36).substring(2, 7).toUpperCase();
        const type = propertyTypes[Math.floor(Math.random() * propertyTypes.length)];
        const totalInCirculation = Math.floor(Math.random() * 1000000);
        
        try {
            const propertyId = await propertyManager.createToken(ticker, totalInCirculation, type);
            console.log(`Added token with ID: ${propertyId}, Ticker: ${ticker}, Type: ${type}`);
        } catch (error) {
            console.error('Error adding token:', error);
        }
    }

    try {
        propertyManager.inspectPropertyIndex()

        const properties = await PropertyManager.getPropertyIndex();
        console.log('Current Properties:', properties);
    } catch (error) {
        console.error('Error retrieving properties:', error);
    }
}

// Call the function to add 5 random tokens and display the list
addRandomTokensAndDisplay(5);
