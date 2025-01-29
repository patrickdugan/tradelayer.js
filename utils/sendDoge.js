const dogecore = require("bitcore-lib-doge");

function createTransaction({ senderAddress, privateKeyWIF, recipientAddress, amountToSend, utxos, fee }) {
  try {
    // Convert amount to send and fee to satoshis
    const satoshisToSend = Math.floor(amountToSend * 1e8);
    const transactionFee = Math.floor(fee * 1e8);

    // Validate UTXOs
    const totalInputSatoshis = utxos.reduce((acc, utxo) => acc + utxo.satoshis, 0);
    if (totalInputSatoshis < satoshisToSend + transactionFee) {
      throw new Error("Insufficient funds for the transaction.");
    }

    // Create a new transaction
    const tx = new dogecore.Transaction()
      .from(utxos) // Add the UTXOs as inputs
      .to(recipientAddress, satoshisToSend) // Specify the recipient and amount
      .change(senderAddress) // Specify the change address
      .fee(transactionFee) // Set the transaction fee
      .sign(privateKeyWIF); // Sign the transaction with the sender's private key

    // Return the serialized raw transaction hex
    return tx.toString();
  } catch (error) {
    console.error("Error creating transaction:", error.message);
    return null;
  }
}

// Example usage
const senderAddress = "DLSfu9qvEggkeXAgCAwBBw5BVLvMCtkewz"; // Replace with your Dogecoin address
const privateKeyWIF = "QW4UD1gNJcYGBPLBGpwTsXKoeVntaT9oNEV1ZU96zTfxc712cwAH"; // Replace with the private key in WIF format
const recipientAddress = "DNWszyeJFD3qX51cCCDZcBKxnTpbN2N8Sh"; // Replace with recipient's Dogecoin address
const amountToSend = 6.0; // Amount of Doge to send
const fee = 1; // Transaction fee in Doge

// Replace this with actual UTXOs from your wallet
const utxos = [
  {
    txId: "fc1835fe96922e6540f614b51b5bcc444db2b860b061ae869ab8aaa41cbbdd6f",
    outputIndex: 0,
    address: senderAddress,
    script: "76a914a7dcce4bf35b50dbe9da38e5dc6758b7ab78ae5a88ac",
    satoshis: 700000000, // 7 Doge in satoshis
  },
];

const rawTx = createTransaction({
  senderAddress,
  privateKeyWIF,
  recipientAddress,
  amountToSend,
  utxos,
  fee,
});

if (rawTx) {
  console.log("Raw Transaction Hex:", rawTx);
} else {
  console.error("Failed to create transaction.");
}
