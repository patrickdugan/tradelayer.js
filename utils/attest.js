'use strict';

/**
 * Stand-alone self-attestation script.
 * Each address attests itself with metadata "CL".
 *
 * Usage:
 *   NODE_ENV=ltctest node standalone_attest_self_CL.js
 */

const clientPromise = require('../src/client').getInstance();
const TxUtils = require('../src/txUtils.js');

// ---------------------------------------------------------
// CONFIG
// ---------------------------------------------------------

// Type number for attestation
const TX_NUMBER = 9;

// Attestation ID (0 means “default/first” — you can bump manually)
const ATTESTATION_ID = 0;

// false → issue, true → revoke
const REVOKE = false;

// Metadata string wanted
const METADATA = "CL";

// Every address attests itself

const ADDRS = [
  "tltc1qzawvfjaevklqj97k0erz32hmkah6r393fj6r6k",
  "tltc1qga7lx3gvd5ze2reqppnk8p3wj3jajwkzv0vxhm",
  "tltc1q2j6mv4vjq8wl6a8q8mr95pvz274rsywxm5esdj",
  "tltc1qcww05prg969haw2nsj9gxnxd90hd2gksgqy5w9",
  "tltc1qwhf8v57z83p5tskecj6433utey72hk78hy0vxu",
  "tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr",
  "tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq",
  "tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u",
  "tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa",
  "tltc1qpqxydlyys2rdnc859q8a3a4a6449pxfke5rcq0",
  "tltc1qkpxncrl473ljasgulxy2hp6y7tr8j84kd5neg2",
  "tltc1qxx206cmmrng9jpllxskha97a8a8p3fqg935p3n",
  "tltc1qxxu6ud6z7luerz0yw6yt9vqjnrmhccnmaj30lz",
  "tltc1qsh29x2ct4pyp8vu9684wuz878ps4rcc5f00wkk",
  "tltc1qp0neu2tpy5mrc5sqxyhjklh7h5hjdp2a7qtvkz",
  "tltc1qsag9648568z36e5qhg82k6jy375w40gl3uwr94",
  "tltc1qer6agsu5ps6td8hz8wvqftrdjs74r2vank9gjz",
  "tltc1qwsphhzq4sv9vylc20tlg0ahauphws9qjq5g9x9"
];


// time between txs to avoid UTXO starvation
const SLEEP_MS = 150;

// ---------------------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------
async function sendAttestationSelf(addr) {

  const params = {
    revoke: REVOKE ? 1 : 0,
    id: ATTESTATION_ID,
    targetAddress: addr,
    metaData: METADATA,
  };

  console.log(`[attest] ${addr} → ${addr} | meta="${METADATA}"`);

  const txid = await TxUtils.createAttestTransaction(
    addr,        // sender
    params,      // attestation parameters
    TX_NUMBER    // 9
  );

  return txid;
}

// ---------------------------------------------------------
async function main() {
  await TxUtils.init();
  await clientPromise;

  console.log(`\n[*] Starting self-attestation batch for ${ADDRS.length} addresses…\n`);

  for (const addr of ADDRS) {
    try {
      const txid = await sendAttestationSelf(addr);
      console.log(`   ✓ ${addr} | txid=${txid}`);
    } catch (err) {
      console.error(`   [ERR] ${addr}:`, err.message || err);
    }

    await sleep(SLEEP_MS);
  }

  console.log(`\n[*] Completed self-attestation batch.\n`);
}

// ---------------------------------------------------------
main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
