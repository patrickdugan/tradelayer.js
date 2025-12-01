const TxUtils = require('../src/txUtils');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const JOBS = [
  { from: 'tltc1qzpeda63ueqpncjugjwxlmsvnfeealqx4zecngn', to: 'tltc1qzawvfjaevklqj97k0erz32hmkah6r393fj6r6k', property: 5, amount: 1000 },
  { from: 'tltc1qpcq6qgea8wkzujmwypyqlnw4z53wqx472htq34', to: 'tltc1qga7lx3gvd5ze2reqppnk8p3wj3jajwkzv0vxhm', property: 5, amount: 500 },
  { from: 'tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t', to: 'tltc1q2j6mv4vjq8wl6a8q8mr95pvz274rsywxm5esdj', property: 5, amount: 912.388 },
  { from: 'tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8', to: 'tltc1qcww05prg969haw2nsj9gxnxd90hd2gksgqy5w9', property: 5, amount: 1000 },
  { from: 'tltc1qm6d6gqvd2wkp9n3h9wx979f9lr60kph9kmu8pp', to: 'tltc1qwhf8v57z83p5tskecj6433utey72hk78hy0vxu', property: 5, amount: 500 },
  { from: 'tltc1qckcm33dssr30shm086y85kcwfvzd29rmv68s9t', to: 'tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr', property: 5, amount: 500 },
  { from: 'tltc1qm7tatw3t27fdj6kre0tkdpkxwh3z3m5runyrnf', to: 'tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq', property: 5, amount: 500 },
  { from: 'tltc1qnw3qrtashmy9r6m3s53kyqg22sdss5ds8jd3dh', to: 'tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u', property: 5, amount: 500 },
  { from: 'tltc1qaahn9x3k44lvguccuqkegv2e0kg5ggeeyljavf', to: 'tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa', property: 5, amount: 500 },
  { from: 'tltc1qer903yvvqs9fanp0mlf77v8he679rc5u89c92z', to: 'tltc1qpqxydlyys2rdnc859q8a3a4a6449pxfke5rcq0', property: 5, amount: 500 }
];

async function runJob(job, idx) {
  console.log(`\n=== Job ${idx + 1}/${JOBS.length} ===`);
  console.log(`FROM: ${job.from}`);
  console.log(`TO:   ${job.to}`);
  console.log(`AMT:  ${job.amount}`);

  try {
    const txid = await TxUtils.sendTransaction(
      job.from,
      job.to,
      job.property,
      job.amount,
      0         // sendAll = false
    );

    console.log(`SUCCESS: ${txid}`);
    return txid;

  } catch (err) {
    console.error(`JOB FAILED`, err);
    return null;
  }
}


// Sequential Gatling Loop (recommended)
async function main() {
  console.log(`Starting token send batch...`);

  const results = [];

  for (let i = 0; i < JOBS.length; i++) {
    const txid = await runJob(JOBS[i], i);
    results.push({ job: i, txid });

    // Prevent mempool-dos or RPC spam
    await sleep(1500);
  }

  console.log("\n=== FINAL RESULTS ===");
  console.log(results);
}

main();
