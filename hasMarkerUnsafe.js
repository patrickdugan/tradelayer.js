function hasMarkerUnsafe(tx) {
    const strClassC = "6f6d6e69"; // Omni in hex format
    const strClassAB = "76a9145c0bc5abc545e8c7387934507bcd20ea0fcb2ff288ac"; // mainnet exodus address scriptPubKey
    const strClassABTest = "00146caf6c62bac6f70e0fc5de5f3f767cdb380aad0a"; // testnet exodus address scriptPubKey
    const strTradeLayer = "746c"; // "tl" in hex format

    for (let n = 0; n < tx.vout.length; ++n) {
        const out = tx.vout[n];
        const str = Buffer.from(out.scriptPubKey).toString('hex');

        if (str.includes(strClassC)) {
            return true;
        }

        if (MainNet()) {
            if (str === strClassAB) {
                return true;
            }
        } else {
            if (str === strClassABTest || str === strTradeLayer) {
                return true;
            }
        }
    }

    return false;
}

// Simulated MainNet function
function MainNet() {
    // Replace this function with your actual logic to determine if you are on the mainnet
    return true; // Change this to false for testnet
}

// Example usage:
const tx = {
    vout: [
        {
            scriptPubKey: Buffer.from("76a9145c0bc5abc545e8c7387934507bcd20ea0fcb2ff288ac", "hex"),
        },
        {
            scriptPubKey: Buffer.from("00146caf6c62bac6f70e0fc5de5f3f767cdb380aad0a", "hex"),
        },
        {
            scriptPubKey: Buffer.from("746c", "hex"), // TradeLayer marker "tl"
        },
    ],
};

const hasOmniMarker = hasMarkerUnsafe(tx);
console.log(`Contains Omni Marker: ${hasOmniMarker}`);