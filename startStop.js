const { exec } = require('child_process');

function startLitecoind() {
    // Starting litecoind with server and RPC flags
    exec('litecoind -daemon --server -rpcuser=yourusername -rpcpassword=yourpassword', (err, stdout, stderr) => {
        if (err) {
            console.error(`Error starting litecoind: ${err}`);
            return;
        }
        console.log(`litecoind started: ${stdout}`);
    });
}

function stopLitecoind() {
    // Stopping litecoind
    exec('litecoin-cli stop', (err, stdout, stderr) => {
        if (err) {
            console.error(`Error stopping litecoind: ${err}`);
            return;
        }
        console.log(`litecoind stopped: ${stdout}`);
    });
}

// Example usage
startLitecoind();
// When you need to stop litecoind, call stopLitecoind()
