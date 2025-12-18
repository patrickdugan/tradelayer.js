/**
 * dustBatch.js
 *
 * Build → sign → broadcast a multi-output LTC dust transaction
 * using bitcore-lib-ltc + your existing TxUtils RPC wrapper.
 *
 * No litecoin-cli, no axios. Fully local.
 */

const litecore = require('bitcore-lib-ltc');
const TxUtils = require('../src/txUtils');     // <-- your actual path
const fs = require('fs');

// --------------------
// CONFIG
// --------------------

const SPONSOR = "tltc1qstal4v4x96u8yftgcnpk88wsa8sps08dhwg446";


const DUST_JOBS = [
  { to: "tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr", amount: 0.005 },
  { to: "tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq", amount: 0.005 },
  { to: "tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u", amount: 0.005 },
  { to: "tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa", amount: 0.005 },
  { to: "tltc1qpqxydlyys2rdnc859q8a3a4a6449pxfke5rcq0", amount: 0.005 },
];

// --------------------
// PROVIDED UTXO
// --------------------

function toSats(x) { return Math.round(x * 1e8); }

const UTXOS = [
  {
    txid: "f878645b2e721732bda1fb585a7206b2015c60d2da520be7f7b4777247c68492",
    vout: 5,
    scriptPubKey: "001482fbfab2a62eb8722568c4c3639dd0e9e0183ced",
    satoshis: toSats(1.31652534)
  }
];

// --------------------
// MAIN PIPELINE
// --------------------

async function main() {

  console.log("\n=== Building dust transaction… ===");

  let tx = new litecore.Transaction();

  // Add UTXO input(s)
  tx.from(UTXOS);

  // Add dust outputs
  for (const job of DUST_JOBS) {
    tx.to(job.to, toSats(job.amount));
  }

  // Change & fee handling
  tx.fee(toSats(0.0002));
  tx.change(SPONSOR);

  // Serialize unsigned raw hex
  const rawUnsigned = tx.uncheckedSerialize();

  fs.writeFileSync("./dust_unsigned.hex", rawUnsigned);
  console.log("\nUnsigned TX HEX:");
  console.log(rawUnsigned);

  console.log("\n=== Signing via TxUtils.signRawTransaction() ===");
  const signed = await TxUtils.signRawTransaction(rawUnsigned);

  if (!signed || !signed.hex) {
    console.error("ERROR: signRawTransaction failed:", signed);
    process.exit(1);
  }

  fs.writeFileSync("./dust_signed.hex", signed.hex);
  console.log("\nSigned TX HEX saved to dust_signed.hex\n");

  console.log("=== Broadcasting via TxUtils.sendRawTransaction() ===");

  const txid = await TxUtils.sendRawTransaction(signed.hex);

  if (!txid) {
    console.error("Broadcast failed. Response:", txid);
    process.exit(1);
  }

  console.log("\n🎉 SUCCESS — broadcasted!");
  console.log("TXID:", txid, "\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
});
