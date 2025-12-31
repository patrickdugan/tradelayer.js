'use strict';

const crypto = require('crypto');
const TxUtils = require('../src/txUtils.js');
const clientPromise = require('../src/client').getInstance();
const Tally = require('../src/tally.js')
/**
 * CONFIG
 */
const CONTRACT_ID = 3;           // futures contract you want to smash
const PROPERTY_ID_MARGIN = 5;    // token 5 for margin / PnL
const NUM_TRADERS = 24;

const TRADER_ADDRESSES = ["tltc1qzq5fruejqg844ulcqc4lfcdwwvfpnf3vf9l73y",
'tltc1q8gvnl4z8tmjtl8hggyqdt59h3n0cg873zjqwp6',
'tltc1q600749ge73rqmef52drmemsgvrk4797e2a7m0u',
'tltc1qnx2cm5dfyhravee74tv6kk45lcyp3ll4eu5g7d'  
];
/*

"tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr",
  "tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq",
  "tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u",
  "tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa",
  "tltc1qpqxydlyys2rdnc859q8a3a4a6449pxfke5rcq0",
"tltc1qkpxncrl473ljasgulxy2hp6y7tr8j84kd5neg2",
  "tltc1qxx206cmmrng9jpllxskha97a8a8p3fqg935p3n",
  "tltc1qsag9648568z36e5qhg82k6jy375w40gl3uwr94",
  "tltc1qer6agsu5ps6td8hz8wvqftrdjs74r2vank9gjz",
  "tltc1qwsphhzq4sv9vylc20tlg0ahauphws9qjq5g9x9"*/

// funding per trader
const FUND_LTC_PER_TRADER   = 0.0005;
const FUND_TOKEN5_PER_TRADER = 500;
const STANDARD_FEE = 0.00002
// admin funding sources (already funded in your test wallet)
const ADMIN_LTC_ADDR    = 'tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m';
const ADMIN_TOKEN5_ADDR = 'tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m';

// spam parameters
const MAX_IN_FLIGHT = 6;                 // global concurrency cap
const MIN_MS_BETWEEN_ORDERS = 8000;
const MAX_MS_BETWEEN_ORDERS = 9000;

// price / size knobs for contract 3
const BASE_PRICE   = 66;     // tweak to whatever makes sense
const PRICE_SPREAD = 6;       // +/- around base
const MIN_CONTRACTS = 10;
const MAX_CONTRACTS = 20;

const tallyMap = {"_id":"tallyMap","block":4494554,"data":"[[\"tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8\",{\"1\":{\"amount\":null,\"available\":45790,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"2\":{\"amount\":null,\"available\":249978,\"reserved\":0,\"margin\":0,\"vesting\":249979,\"channelBalance\":0},\"3\":{\"amount\":null,\"available\":1383073,\"reserved\":0,\"margin\":0,\"vesting\":1383074,\"channelBalance\":0},\"4\":{\"amount\":null,\"available\":0.99988,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":2e-8},\"5\":{\"amount\":null,\"available\":613913,\"reserved\":160,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"6\":{\"amount\":null,\"available\":471902,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"7\":{\"amount\":null,\"available\":741256,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"MWip91xMhaEmDn5oUW5NDNbWSDyG5dSK9Q\",{\"1\":{\"amount\":null,\"available\":50000,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"LNmiS6p8z3KuHHx3q6Jf6x6TfcyptE68oP\",{\"2\":{\"amount\":null,\"available\":2,\"reserved\":0,\"margin\":0,\"vesting\":1,\"channelBalance\":0},\"3\":{\"amount\":null,\"available\":7926,\"reserved\":0,\"margin\":0,\"vesting\":7925,\"channelBalance\":0}}],[\"mj4iTwbHiQX6objWNXHjerF2KQDFcPCdUx\",{\"3\":{\"amount\":null,\"available\":7027,\"reserved\":0,\"margin\":0,\"vesting\":7027,\"channelBalance\":0}}],[\"tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk\",{\"3\":{\"amount\":null,\"available\":84734,\"reserved\":0,\"margin\":0,\"vesting\":84734,\"channelBalance\":0},\"4\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0.00011998}}],[\"tltc1q8xw3vsvkv77dpj59nqn30rxlc9m3xjw76cgrac\",{\"3\":{\"amount\":null,\"available\":200,\"reserved\":0,\"margin\":0,\"vesting\":200,\"channelBalance\":0}}],[\"tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz\",{\"3\":{\"amount\":null,\"available\":17000,\"reserved\":0,\"margin\":0,\"vesting\":17001,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":50464,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qrqj98tenvn0pgrp7shktmcwn7zupxj3rmjfsar\",{\"3\":{\"amount\":null,\"available\":40,\"reserved\":0,\"margin\":0,\"vesting\":39,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q45ch75q2p0f0v02tvv56pzlneusxw2rpz5e58l\",{\"3\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr\",{\"1\":{\"amount\":null,\"available\":10,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":2674,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qk7gr80pmlh0j840zl0ce5wa3ev995jlcwlq6s4\",{\"5\":{\"amount\":null,\"available\":17,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qvzxl5xd8wdh4xf7e2xax30ev8fv6r78z9syvxq\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qp5z2la8sy69np798pc36up5zk2vg0fw2g7pml2\",{\"1\":{\"amount\":null,\"available\":2000,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":499.9999995,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":5e-7}}],[\"tltc1q888dr4chqjl9fnws2cs3c7q48uck54f2vtclk9\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qzpeda63ueqpncjugjwxlmsvnfeealqx4zecngn\",{\"5\":{\"amount\":null,\"available\":1000,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qpcq6qgea8wkzujmwypyqlnw4z53wqx472htq34\",{\"1\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qjyekaq86kqersjddwyjgydemw23jkg8d52j22m\",{\"1\":{\"amount\":null,\"available\":1000,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf\",{\"1\":{\"amount\":null,\"available\":30,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"2\":{\"amount\":null,\"available\":10,\"reserved\":0,\"margin\":0,\"vesting\":10,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":77.56,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t\",{\"1\":{\"amount\":null,\"available\":6.992668,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"2\":{\"amount\":null,\"available\":10,\"reserved\":0,\"margin\":0,\"vesting\":10,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":912.388,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qp0slhm9jxghmguagclf2vtevmy7tpw5jhmalte\",{\"1\":{\"amount\":null,\"available\":720.748168,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"5\":{\"amount\":null,\"available\":400,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8\",{\"5\":{\"amount\":null,\"available\":1000,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qy8gyqm0hd225yq57lresv6uua68l628ukqhh86gxgl5fltls9pvsv73rex\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0.1}}],[\"tltc1q9shql037ls5a4hlyc467ckxtxgfjupa2djedep\",{\"1\":{\"amount\":null,\"available\":100,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q2jujptzt322898yff8955zre6jkt6m96mhxwrk\",{\"1\":{\"amount\":null,\"available\":10,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qaehflfktnpe0vwhdvq830hxc40kmdyx80dd6qkcfdglwfzhs6qcqj26hys\",{\"1\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":240.23689}}],[\"tltc1q3fnfmqyhf20fyfvhg9q0xmwwtx35mtxlvvsje8n5k6k8qc35tsfs6zg9p8\",{\"1\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":68.424074}}],[\"tltc1qm6d6gqvd2wkp9n3h9wx979f9lr60kph9kmu8pp\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qf485n2r25d3d9v9zj0f8wg4xhd07egkuner9k6\",{\"5\":{\"amount\":null,\"available\":100,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qv73wdqhvjjqv06g2cwr7a9kvr5hmnum8ktetjfdm763sxynqs2ks9x3suf\",{\"1\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":11.29}}],[\"tltc1qxcyu5682whfzpjunwu6ek39dvc8lqmjtvxmscc\",{\"5\":{\"amount\":null,\"available\":1000,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qtee90ysf57393hfqyn79syj9mkekm7hq0epqzw\",{\"5\":{\"amount\":null,\"available\":1000,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q03chaswwrerwplkch8n4xc6nfyxyuu8fn3hs3zllstcx57r64r4sa8cvsa\",{\"1\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":10.6082},\"8\":{\"amount\":null,\"available\":109,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0},\"9\":{\"amount\":null,\"available\":325,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qkryugtrwmmru644n2juk5vqqpnt606ygwdf2m7vzcjxw4wmzs9aslch4wk\",{\"1\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":1.7},\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0.002}}],[\"tltc1qa656fx6mtgvf8dvp92zxt995r6h0zdfuwwka2a3y0v7kjhrfxlqsxxs3r9\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":22.45}}],[\"tltc1qp8aj4r5m8rphn3jjqzf7xye7927srzl8f674r22wjqyx0th5rzlqd6nvhh\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":10}}],[\"tltc1q2qc93tunmlgda472crh3f8ms8v6yqsq7y6w3q3265yj8eug5yh8stlffzn\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":7.5}}],[\"tltc1qckcm33dssr30shm086y85kcwfvzd29rmv68s9t\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q54k4y4mtrf5zryp9052zvjs8c29hv93t5utg2h\",{\"5\":{\"amount\":null,\"available\":2500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qm7tatw3t27fdj6kre0tkdpkxwh3z3m5runyrnf\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qnw3qrtashmy9r6m3s53kyqg22sdss5ds8jd3dh\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qaahn9x3k44lvguccuqkegv2e0kg5ggeeyljavf\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qer903yvvqs9fanp0mlf77v8he679rc5u89c92z\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qzdj28chupe5hufw99d8hwv6qh65vtfujfenhml\",{\"5\":{\"amount\":null,\"available\":2500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qzd45hj0ts3als4j3duzyutcxjjqqvmvknr9ua9\",{\"5\":{\"amount\":null,\"available\":2500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q49sxgvvtpr7p6d4azcv68tgfdaf0mykyhlsexx\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q07ux9uzzgtkfykz67hy4z3530aks247emkxhj7\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qtq7kmccws4r5ervtu5xra6wwkfwkzgg4heftzm\",{\"5\":{\"amount\":null,\"available\":2500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qmqt7u2dtd6fnclqcfmuz8nh5w6qnqsla7tzyyt\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qljeztg6p9a70pmtj3rcdr9hkzrspqvdjvt9htu\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qry6dq9kje5uku06avwe64wwrk56nn4jn2sddyd\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qjyz8sduhu2kjjaf6pyk6tcwfq3qyykjvjda0g4\",{\"5\":{\"amount\":null,\"available\":2500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qn4l6d4k5cz9ney66axm5k3usal2t5cw739lm2p\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qnx2cm5dfyhravee74tv6kk45lcyp3ll4eu5g7d\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qzq5fruejqg844ulcqc4lfcdwwvfpnf3vf9l73y\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q8gvnl4z8tmjtl8hggyqdt59h3n0cg873zjqwp6\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q600749ge73rqmef52drmemsgvrk4797e2a7m0u\",{\"5\":{\"amount\":null,\"available\":500,\"reserved\":0,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq\",{\"5\":{\"amount\":null,\"available\":0.358,\"reserved\":580.772,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":296,\"margin\":122.87,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qpqxydlyys2rdnc859q8a3a4a6449pxfke5rcq0\",{\"5\":{\"amount\":null,\"available\":0.91,\"reserved\":499.09,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u\",{\"5\":{\"amount\":null,\"available\":0,\"reserved\":0,\"margin\":102.417,\"vesting\":0,\"channelBalance\":0}}],[\"tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr\",{\"5\":{\"amount\":null,\"available\":1.4045,\"reserved\":896.176,\"margin\":0,\"vesting\":0,\"channelBalance\":0}}]]"}
/**
 * Little helpers
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const randInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randFloat = (min, max, decimals = 2) => {
  const v = Math.random() * (max - min) + min;
  return Number(v.toFixed(decimals));
};

const randomSide = () => (Math.random() < 0.5 ? 'BUY' : 'SELL');

const randomPrice = () => {
  const offset = randFloat(-PRICE_SPREAD, PRICE_SPREAD, 2);
  return Number((BASE_PRICE + offset).toFixed(2));
};

const randomContracts = () => randInt(MIN_CONTRACTS, MAX_CONTRACTS);

/**
 * 1) Make N trader/channel addresses and fund them with LTC + token 5
 */
async function bootstrapTraders(client) {

  // Step 1: find existing funded traders
  const existing = await collectExistingTraders(client);
  console.log('existing '+JSON.stringify(existing))
  // Step 2: determine how many more we need
  const countNeeded = Math.max(0, NUM_TRADERS - existing.length);

  // Step 3: create only the remaining traders
  //const created = await bootstrapNewTraders(client, countNeeded);

  // Step 4: merge and return as structured trader objects
  const allAddrs = TRADER_ADDRESSES//[...existing/*, ...created*/];

  const traders = allAddrs.map((addr, idx) => ({
    index: idx,
    address: addr,
    busy: false,
  }));

  console.log(`[*] Trader pool ready: ${traders.length} traders total.`);
  return traders;
}


async function bootstrapNewTraders(client) {
  const traders = [];

  console.log(`[*] Creating ${NUM_TRADERS} trader addresses…`);

  for (let i = 0; i < NUM_TRADERS; i++) {
    const label = `spam_trader_${i}`;
    const addr = await client.getnewaddress(label, 'bech32');
    console.log(`[+] trader[${i}] = ${addr}`);

    // 1a) fund LTC straight from wallet (using ADMIN_LTC_ADDR’s balance)
    const ltcTxid = await client.sendtoaddress(addr, FUND_LTC_PER_TRADER);
    console.log(`    -> +${FUND_LTC_PER_TRADER} tLTC: ${ltcTxid}`);

    // 1b) fund token 5 via Omni/TL send using TxUtils
    const tokenAmount = FUND_TOKEN5_PER_TRADER;

    const tokenTxid = await TxUtils.sendTransaction(
      ADMIN_TOKEN5_ADDR,
      addr,
      PROPERTY_ID_MARGIN,
      tokenAmount,
      0 // sendAll flag
    );
    console.log(`    -> +${tokenAmount} of property ${PROPERTY_ID_MARGIN}: ${tokenTxid}`);

    traders.push({
      index: i,
      address: addr,
      busy: false,
    });

    // let UTXOs settle a bit / avoid listunspent races
    await sleep(500);
  }

  console.log(`[*] Bootstrapped ${traders.length} traders.`);
  return traders;
}

async function collectExistingTraders(maybeClient, minToken5 = 1) {
    let addresses = [];

    // --- STEP 1: detect client and pull addresses ---
    if (maybeClient && typeof maybeClient.listUnspent === "function") {
        //try {
            const utxos = await maybeClient.listUnspent();
            console.log('utxos '+JSON.stringify(utxos))
            addresses = [...new Set(utxos.map(u => u.address))];
        //} catch (e) {
        //    console.log("[COLLECT] listUnspent failed:", e);
        //    addresses = [];
        //}
    }
    // otherwise assume user already passed an array
    else if (Array.isArray(maybeClient)) {
        addresses = maybeClient;
    }
    else {
        console.log("[COLLECT] Invalid param passed to collectExistingTraders");
        return [];
    }

    // --- STEP 2: load tally blob (global tallyMap object) ---
    const tallyRecord = tallyMap; // your global JSON object
    const traders = [];

    if (!tallyRecord || typeof tallyRecord.data !== "string") {
        console.log("[COLLECT] tallyMap missing or malformed.");
        return traders;
    }

    // --- STEP 3: parse tally blob ---
    let tallyArray;
    try {
        tallyArray = JSON.parse(tallyRecord.data);
    } catch (err) {
        console.log("[COLLECT] Cannot parse tallyMap.data:", err);
        return traders;
    }

    // --- STEP 4: match each address → property 5 available ---
    for (const addr of addresses) {
        const row = tallyArray.find(([a]) => a === addr);
        if (!row) continue;

        const props = row[1];
        const p5 = props["5"];
        if (!p5) continue;

        const available = p5.available || 0;

        if (available >= minToken5) {
            traders.push({
                address: addr,
                token5: available,
                busy: false,
            });
            console.log(`[+] Existing trader: ${addr} (prop5=${available})`);
        }
    }

    return traders;
}

function extractAvailable(tallyArray, address, propertyId = "5") {
    if (!Array.isArray(tallyArray)) return 0;

    const row = tallyArray.find(entry => entry[0] === address);
    if (!row) return 0;

    const props = row[1] || {};
    const p = props[propertyId];
    if (!p) return 0;

    return Number(p.available || 0);
}


/**
 * 2) Fire a single type-18 futures order from a given trader
 *
 * 👉 This is where you plug in whatever you were doing in tradeFutures.js
 *    (your actual type-18 builder/sender).
 */
 async function sendType18Order(traderAddr, side, priceFloat, contracts) {
  const action = (side === 'BUY') ? 0 : 1;

      console.log('firing for '+traderAddr)
  const contractParams = {
    contractId: CONTRACT_ID,
    sell: action,
    amount: contracts,
    price: priceFloat,
  };

  console.log(`[tx18] ${side} ${contracts} @ ${priceFloat}`);

  // 🚀 Use YOUR existing txUtils code:
  const txid = await TxUtils.createContractOnChainTradeTransaction(
    traderAddr,
    contractParams
  );

  return txid;
}



/**
 * 3) Spam loop: randomly choose a trader, build a type-18 order, broadcast.
 *    Because type 18 uses on-chain book, matching just happens as txs land.
 */
async function spamLoop(traders, client) {
  console.log('[*] Entering sorceror’s apprentice loop (type-18)…');

  let inFlight = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (inFlight >= MAX_IN_FLIGHT) {
      await sleep(20);
      continue;
    }

    const available = traders.filter(t => !t.busy);
    if (!available.length) {
      await sleep(10);
      continue;
    }

    const trader = available[randInt(0, available.length - 1)];
    trader.busy = true;
    inFlight += 1;

    const side = 'BUY'//randomSide();
    const price = randomPrice();
    let contracts = randomContracts();
    if(contracts>5){contracts = 5}
    (async () => {
      try {
        await sendType18Order(trader.address, side, price, contracts);
        // once you wire it, type-18 hits chain → orderbook → matches
      } catch (err) {
        console.error(
          `[err] trader[${trader.index}] ${side} ${contracts} @ ${price} failed:`,
          err.message || err
        );
      } finally {
        trader.busy = false;
        inFlight -= 1;
      }
    })();

    const delay = randInt(MIN_MS_BETWEEN_ORDERS, MAX_MS_BETWEEN_ORDERS);
    await sleep(delay);
  }
}

/**
 * 4) Main
 *
 * Run your normal TL listener/main in one process,
 * then in another:
 *   NODE_ENV=ltctest node scripts/sorcerors_apprentice_type18.js
 */
async function main() {
  console.log('[*] Init TxUtils + client…');
  await TxUtils.init();
  const client = await clientPromise;

  const traders = await bootstrapTraders(client);
  await spamLoop(traders, client);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

module.exports = {sendType18Order}