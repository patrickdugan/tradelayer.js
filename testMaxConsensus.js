const expressInterface = require('./walletInterface.js')

async function someAsyncFunction() {
    try {
        const maxProcessedHeight = await expressInterface.getMaxProcessedHeight();
        console.log("Max processed height:", maxProcessedHeight);
    } catch (error) {
        console.error("Error:", error);
    }
}

someAsyncFunction()