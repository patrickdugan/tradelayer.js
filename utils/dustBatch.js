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
  { to: "tltc1qzq5fruejqg844ulcqc4lfcdwwvfpnf3vf9l73y", amount: 0.005 },
  { to: "tltc1q8gvnl4z8tmjtl8hggyqdt59h3n0cg873zjqwp6", amount: 0.005 },
  { to: "tltc1q600749ge73rqmef52drmemsgvrk4797e2a7m0u", amount: 0.005 },
  { to: "tltc1qnx2cm5dfyhravee74tv6kk45lcyp3ll4eu5g7d", amount: 0.005 },
];

// --------------------
// PROVIDED UTXO
// --------------------

function toSats(x) { return Math.round(x * 1e8); }

const UTXOS = [
  {
    txid: "76a47f97d0814d7bfdf974d03e1bfd1603c75b3038f531a41d61f5ed61fe1b8e",
    vout: 1,
    scriptPubKey: "001482fbfab2a62eb8722568c4c3639dd0e9e0183ced",
    satoshis: toSats(1.28012534)
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
