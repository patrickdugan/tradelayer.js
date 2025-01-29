const dogecore = require("bitcore-lib-doge"); // Dogecoin library
const Encode = require("../src/txEncoder.js");

// Constants
const STANDARD_FEE = 250000; // 0.01 DOGE in satoshis
const DUST_THRESHOLD = 1000000; // 0.01 DOGE in satoshis (dust threshold)

// Function to send Dogecoin
async function sendDogecoin(senderAddress, recipientAddress, amountToSend) {
  //try {
    // Define UTXOs for the sender address
    const utxos = [
      {
        txId: "5144f44bc8cec947eb757ce9377f75f3321f2f0f92cd1e2526526df1179ae744",
        outputIndex: 0,
        address: senderAddress,
        script: "76a914226eae66f1d4da7f47015be99d1c4e2484e39b9c88ac", // P2PKH script
        satoshis: 78750000, // 0.1 DOGE in satoshis
      },
    ];

    // Calculate total input balance
    const totalInput = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);


    // Calculate change
    const change = totalInput - amountToSend - STANDARD_FEE;
    const out = amountToSend-STANDARD_FEE
    // Prepare OP_RETURN payload
    const params = {
      sendAll: 0,
      propertyId: 1,
      amount: 20000000,
      address: "D7NdPZKMnMo9pdmJik15TLDCSN9rXBFNMa", // Example Dogecoin address
      isColoredOutput: 0,
    };
    const opReturnData = Encode.encodeSend(params);
    const opReturnScript = dogecore.Script.buildDataOut(opReturnData);

    // Create transaction
    const tx = new dogecore.Transaction()
      .from(utxos)
      .to(recipientAddress, out) // Send specified amount
      .fee(STANDARD_FEE) // Include transaction fee
      .addOutput(
        new dogecore.Transaction.Output({
          script: opReturnScript,
          satoshis: 0, // OP_RETURN value must be 0
        })
      );


    // Serialize transaction
    const serializedTx = tx.toString();
    console.log(`Transaction hex: ${serializedTx}`);
  //} catch (error) {
    //console.error("Error constructing transaction:", error.message);
  //}
}

// Replace with actual values
const senderAddress = "D8HA73pAhxK7eNXSUVhQrWpUkrszUDGs7Z"; // Example sender address
const recipientAddress = "D8HA73pAhxK7eNXSUVhQrWpUkrszUDGs7Z"; // Example recipient address
const amountToSend = 78750000; // 0.09 DOGE in satoshis

// Execute the function
sendDogecoin(senderAddress, recipientAddress, amountToSend);
