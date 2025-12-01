/**
 * TradeLayer Token Redistribution Helper
 * ---------------------------------------
 * Loads tally.json -> extracts property-5 holders -> builds:
 *   (1) dust funding outputs
 *   (2) token-send job list to TRADER_ADDRESSES
 */

const fs = require('fs');

// ----------- CONFIG ---------------

const TALLY_FILE = {
  "_id": "tallyMap",
  "block": 4437480,
  "data": [
    [
      "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8",
      {
        "1": {
          "amount": null,
          "available": 45714.85604987,
          "reserved": 75.14395013,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "2": {
          "amount": null,
          "available": 249978,
          "reserved": 0,
          "margin": 0,
          "vesting": 249979,
          "channelBalance": 0
        },
        "3": {
          "amount": null,
          "available": 1383073,
          "reserved": 0,
          "margin": 0,
          "vesting": 1383074,
          "channelBalance": 0
        },
        "4": {
          "amount": null,
          "available": 0.99988,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 2e-8
        },
        "5": {
          "amount": null,
          "available": 613913,
          "reserved": 160,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "6": {
          "amount": null,
          "available": 471902,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "7": {
          "amount": null,
          "available": 741256,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "MWip91xMhaEmDn5oUW5NDNbWSDyG5dSK9Q",
      {
        "1": {
          "amount": null,
          "available": 50000,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "LNmiS6p8z3KuHHx3q6Jf6x6TfcyptE68oP",
      {
        "2": {
          "amount": null,
          "available": 2,
          "reserved": 0,
          "margin": 0,
          "vesting": 1,
          "channelBalance": 0
        },
        "3": {
          "amount": null,
          "available": 7926,
          "reserved": 0,
          "margin": 0,
          "vesting": 7925,
          "channelBalance": 0
        }
      }
    ],
    [
      "mj4iTwbHiQX6objWNXHjerF2KQDFcPCdUx",
      {
        "3": {
          "amount": null,
          "available": 7027,
          "reserved": 0,
          "margin": 0,
          "vesting": 7027,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk",
      {
        "3": {
          "amount": null,
          "available": 84734,
          "reserved": 0,
          "margin": 0,
          "vesting": 84734,
          "channelBalance": 0
        },
        "4": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0.00011998
        }
      }
    ],
    [
      "tltc1q8xw3vsvkv77dpj59nqn30rxlc9m3xjw76cgrac",
      {
        "3": {
          "amount": null,
          "available": 200,
          "reserved": 0,
          "margin": 0,
          "vesting": 200,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz",
      {
        "3": {
          "amount": null,
          "available": 17000,
          "reserved": 0,
          "margin": 0,
          "vesting": 17001,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 50464,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qrqj98tenvn0pgrp7shktmcwn7zupxj3rmjfsar",
      {
        "3": {
          "amount": null,
          "available": 40,
          "reserved": 0,
          "margin": 0,
          "vesting": 39,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1q45ch75q2p0f0v02tvv56pzlneusxw2rpz5e58l",
      {
        "3": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr",
      {
        "1": {
          "amount": null,
          "available": 10,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 5406.43443908,
          "reserved": 5343.750037,
          "margin": 6768.75000212,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qk7gr80pmlh0j840zl0ce5wa3ev995jlcwlq6s4",
      {
        "5": {
          "amount": null,
          "available": 17,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qvzxl5xd8wdh4xf7e2xax30ev8fv6r78z9syvxq",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qp5z2la8sy69np798pc36up5zk2vg0fw2g7pml2",
      {
        "1": {
          "amount": null,
          "available": 2000,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 499.9999995,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 5e-7
        }
      }
    ],
    [
      "tltc1q888dr4chqjl9fnws2cs3c7q48uck54f2vtclk9",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qzpeda63ueqpncjugjwxlmsvnfeealqx4zecngn",
      {
        "5": {
          "amount": null,
          "available": 1000,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qpcq6qgea8wkzujmwypyqlnw4z53wqx472htq34",
      {
        "1": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 500,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qjyekaq86kqersjddwyjgydemw23jkg8d52j22m",
      {
        "1": {
          "amount": null,
          "available": 1000,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf",
      {
        "1": {
          "amount": null,
          "available": 30,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "2": {
          "amount": null,
          "available": 10,
          "reserved": 0,
          "margin": 0,
          "vesting": 10,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 77.56,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t",
      {
        "1": {
          "amount": null,
          "available": 7.46560402,
          "reserved": 0,
          "margin": 29.15778736,
          "vesting": 0,
          "channelBalance": 0
        },
        "2": {
          "amount": null,
          "available": 10,
          "reserved": 0,
          "margin": 0,
          "vesting": 10,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 912.388,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qp0slhm9jxghmguagclf2vtevmy7tpw5jhmalte",
      {
        "1": {
          "amount": null,
          "available": 720.2381934,
          "reserved": 0,
          "margin": 29.15778736,
          "vesting": 0,
          "channelBalance": 0
        },
        "5": {
          "amount": null,
          "available": 400,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qvlwcnwlhnja7wlj685ptwxej75mms9nyv7vuy8",
      {
        "5": {
          "amount": null,
          "available": 1000,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qy8gyqm0hd225yq57lresv6uua68l628ukqhh86gxgl5fltls9pvsv73rex",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0.1
        }
      }
    ],
    [
      "tltc1q9shql037ls5a4hlyc467ckxtxgfjupa2djedep",
      {
        "1": {
          "amount": null,
          "available": 100,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1q2jujptzt322898yff8955zre6jkt6m96mhxwrk",
      {
        "1": {
          "amount": null,
          "available": 10,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qaehflfktnpe0vwhdvq830hxc40kmdyx80dd6qkcfdglwfzhs6qcqj26hys",
      {
        "1": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 200.11691046
        }
      }
    ],
    [
      "tltc1q3fnfmqyhf20fyfvhg9q0xmwwtx35mtxlvvsje8n5k6k8qc35tsfs6zg9p8",
      {
        "1": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 50.22847882
        }
      }
    ],
    [
      "tltc1qm6d6gqvd2wkp9n3h9wx979f9lr60kph9kmu8pp",
      {
        "5": {
          "amount": null,
          "available": 500,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qf485n2r25d3d9v9zj0f8wg4xhd07egkuner9k6",
      {
        "5": {
          "amount": null,
          "available": 100,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qv73wdqhvjjqv06g2cwr7a9kvr5hmnum8ktetjfdm763sxynqs2ks9x3suf",
      {
        "1": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 11.29
        }
      }
    ],
    [
      "tltc1qxcyu5682whfzpjunwu6ek39dvc8lqmjtvxmscc",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qtee90ysf57393hfqyn79syj9mkekm7hq0epqzw",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m",
      {
        "5": {
          "amount": null,
          "available": 493.5125,
          "reserved": 0,
          "margin": 6768.75,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1q03chaswwrerwplkch8n4xc6nfyxyuu8fn3hs3zllstcx57r64r4sa8cvsa",
      {
        "1": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 10.6082
        },
        "8": {
          "amount": null,
          "available": 109,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        },
        "9": {
          "amount": null,
          "available": 325,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qkryugtrwmmru644n2juk5vqqpnt606ygwdf2m7vzcjxw4wmzs9aslch4wk",
      {
        "1": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 1.7
        },
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0.002
        }
      }
    ],
    [
      "tltc1qa656fx6mtgvf8dvp92zxt995r6h0zdfuwwka2a3y0v7kjhrfxlqsxxs3r9",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 22.45
        }
      }
    ],
    [
      "tltc1qp8aj4r5m8rphn3jjqzf7xye7927srzl8f674r22wjqyx0th5rzlqd6nvhh",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 10
        }
      }
    ],
    [
      "tltc1q2qc93tunmlgda472crh3f8ms8v6yqsq7y6w3q3265yj8eug5yh8stlffzn",
      {
        "5": {
          "amount": null,
          "available": 0,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 7.5
        }
      }
    ],
    [
      "tltc1qckcm33dssr30shm086y85kcwfvzd29rmv68s9t",
      {
        "5": {
          "amount": null,
          "available": 500,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qm7tatw3t27fdj6kre0tkdpkxwh3z3m5runyrnf",
      {
        "5": {
          "amount": null,
          "available": 500,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qnw3qrtashmy9r6m3s53kyqg22sdss5ds8jd3dh",
      {
        "5": {
          "amount": null,
          "available": 500,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qaahn9x3k44lvguccuqkegv2e0kg5ggeeyljavf",
      {
        "5": {
          "amount": null,
          "available": 500,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ],
    [
      "tltc1qer903yvvqs9fanp0mlf77v8he679rc5u89c92z",
      {
        "5": {
          "amount": null,
          "available": 500,
          "reserved": 0,
          "margin": 0,
          "vesting": 0,
          "channelBalance": 0
        }
      }
    ]
  ]
}
      // path to your file
const SPONSOR = 'tltc1qstal4v4x96u8yftgcnpk88wsa8sps08dhwg446';   // LTC-rich address
const DUST = 0.00002;                   // 2000 sats per address

// Destination trader addresses (your provided list)
const TRADER_ADDRESSES = [
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
  "tltc1qsag9648568z36e5qhg82k6jy375w40gl3uwr94",
  "tltc1qer6agsu5ps6td8hz8wvqftrdjs74r2vank9gjz",
  "tltc1qwsphhzq4sv9vylc20tlg0ahauphws9qjq5g9x9"
];

// ----------- LOAD TALLYMAP ---------------

//const outer = JSON.parse(fs.readFileSync(TALLY_FILE, 'utf8'));
const entries = TALLY_FILE.data;

// ----------- FIND PROP-5 HOLDERS (500–2500 TOKENS) ---------------

const tokenHolders = [];
const tokenTotals = [];

for (const [address, props] of entries) {
  if (!props[5]) continue;

  const amt = props[5].available || 0;

  if (amt >= 500 && amt <= 2500) {
    tokenHolders.push(address);
    tokenTotals.push(amt);
  }
}

// ----------- BUILD DUST FUNDING JOBS ---------------

const dustOutputs = tokenHolders.map(addr => ({
  from: SPONSOR,
  to: addr,
  amount: DUST
}));

// ----------- BUILD TOKEN SEND JOB LIST ---------------

const sends = [];
const N = Math.min(tokenHolders.length, TRADER_ADDRESSES.length);

for (let i = 0; i < N; i++) {
  sends.push({
    from: tokenHolders[i],
    to: TRADER_ADDRESSES[i],
    property: 5,
    amount: tokenTotals[i]
  });
}

// ----------- PRINT RESULTS ---------------

console.log("=== PROPERTY 5 HOLDERS (500–2500 tokens) ===");
console.log(tokenHolders);

console.log("\n=== TOKEN TOTALS (aligned) ===");
console.log(tokenTotals);

console.log("\n=== DUST FUNDING OUTPUTS (0.00002 LTC each) ===");
console.log(dustOutputs);

console.log("\n=== TOKEN SEND JOBS (aligned 1:1) ===");
console.log(sends);

console.log(`\nSummary:
  Total eligible holders: ${tokenHolders.length}
  Dust TX outputs needed: ${dustOutputs.length}
  Token sends generated : ${sends.length}
`);
