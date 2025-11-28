'use strict';

/**
 * Stand-alone LTC refill script for TL testnet accounts.
 * Only refills LTC (no token 5 sends).
 *
 * Usage:
 *   NODE_ENV=ltctest node standalone_refill_ltc_only.js
 */

const clientPromise = require('../src/client').getInstance();
const TxUtils = require('../src/txUtils.js'); // still needed for init()

// ---------------------------------------------------------
// CONFIG — EDIT THESE
// ---------------------------------------------------------

// where LTC is taken from (this wallet must have balance)
const SOURCE_LTC_ADDR = 'tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m';

// amount to send each address
const REFILL_LTC = 0.0005;

// addresses you want to refill (paste your list)
const TARGET_ADDRS = [
    "tltc1qxxu6ud6z7luerz0yw6yt9vqjnrmhccnmaj30lz",
    "tltc1qp0neu2tpy5mrc5sqxyhjklh7h5hjdp2a7qtvkz",
    "tltc1qxx206cmmrng9jpllxskha97a8a8p3fqg935p3n",
    "tltc1q540ddjrp9shhfhx8gpnerkfssxm8pcqqnw5s2v",
    "tltc1qga7lx3gvd5ze2reqppnk8p3wj3jajwkzv0vxhm",
    "tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa",
    "tltc1qwsphhzq4sv9vylc20tlg0ahauphws9qjq5g9x9",
    "tltc1qdm7ww7h7jfrmpjky3jw5dq5rdqlxqtzvx7rq5c",
    "tltc1qkpxncrl473ljasgulxy2hp6y7tr8j84kd5neg2",
    "tltc1qpqxydlyys2rdnc859q8a3a4a6449pxfke5rcq0",
    "tltc1qqpfac2c2mfg9twt464yedqduvhze86yrxxywv6",
    "tltc1qer6agsu5ps6td8hz8wvqftrdjs74r2vank9gjz",
    "tltc1qcww05prg969haw2nsj9gxnxd90hd2gksgqy5w9",
    "tltc1qzl2rded7havq59cr60292mp55asdh3tm5jtljx",
    "tltc1q2e4r20jq4dctuayfnjs2xjs9cxsm6fdhnvcm4j",
    "tltc1qugvaym79c9m329xl5ettpv7sjnlkrmhu4enu9h",
    "tltc1qx3ffxhydg2ec8y8e83y8ptk5907ssngekjcnlm",
    "tltc1qnasau2wk29dnl4p493hzkm2xx8qhd4t7zqkhjc",
    "tltc1q2j6mv4vjq8wl6a8q8mr95pvz274rsywxm5esdj",
    "tltc1qsh29x2ct4pyp8vu9684wuz878ps4rcc5f00wkk",
    "tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u",
    "tltc1qzawvfjaevklqj97k0erz32hmkah6r393fj6r6k",
    "tltc1q9em9nrqkwfx04auxaxm0tz6hk2ey0jrjknteh2",
    "tltc1qhw38ffkrtwf9fu77mpy55wxkc4qkqysrlaz72z",
    "tltc1qwhf8v57z83p5tskecj6433utey72hk78hy0vxu",
    "tltc1qd4d6xw6yt72n5k4s0ydnwpe9ljhpdfxyq6r4dm",
    "tltc1qsag9648568z36e5qhg82k6jy375w40gl3uwr94",
    "tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq",
    "tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr"
];

// ---------------------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------
async function refill() {

    await TxUtils.init();
    const client = await clientPromise;

    console.log(`\n[*] Starting LTC-only refill for ${TARGET_ADDRS.length} addresses…\n`);

    for (const addr of TARGET_ADDRS) {
        console.log(`[→] Sending ${REFILL_LTC} LTC to ${addr}`);

        try {
            const txid = await client.sendtoaddress(addr, REFILL_LTC);
            console.log(`   ✓ txid: ${txid}`);
        } catch (err) {
            console.error(`   [ERR] failed for ${addr}:`, err.message || err);
        }

        await sleep(150);  // lightly throttle UTXO usage
    }

    console.log("\n[*] LTC refill complete.\n");
}

// ---------------------------------------------------------
refill().catch(err => {
    console.error("[FATAL]", err);
    process.exit(1);
});
