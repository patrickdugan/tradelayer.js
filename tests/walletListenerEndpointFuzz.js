const axios = require('axios');

const BASE_URL = process.env.TL_LISTENER_URL || 'http://127.0.0.1:3000';
const ROUNDS = Number(process.env.FUZZ_ROUNDS || 120);
const TIMEOUT_MS = Number(process.env.FUZZ_TIMEOUT_MS || 4000);

const ENDPOINTS = [
  '/tl_getMaxProcessedHeight',
  '/tl_getMaxParsedHeight',
  '/tl_getTrackHeight',
  '/tl_checkSync'
];

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function randString() {
  return Math.random().toString(36).slice(2);
}

function randomBody() {
  switch (randInt(10)) {
    case 0: return null;
    case 1: return randString();
    case 2: return randInt(1_000_000);
    case 3: return true;
    case 4: return [randString(), randInt(100), { nested: randString() }];
    case 5: return { params: randString() };
    case 6: return { params: [randString(), randInt(100)] };
    case 7: return { weird: { a: { b: { c: randString() } } } };
    case 8: return { large: 'x'.repeat(4096) };
    default: return {};
  }
}

async function hit(endpoint, body) {
  try {
    const payload = JSON.stringify(body);
    const res = await axios.post(`${BASE_URL}${endpoint}`, body, {
      timeout: TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      transformRequest: [() => payload],
      validateStatus: () => true
    });
    return { ok: true, status: res.status };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

async function main() {
  const stats = {};
  for (const endpoint of ENDPOINTS) {
    stats[endpoint] = { total: 0, ok2xx: 0, err4xx: 0, err5xx: 0, networkErr: 0 };
  }

  for (let i = 0; i < ROUNDS; i++) {
    for (const endpoint of ENDPOINTS) {
      const result = await hit(endpoint, randomBody());
      const s = stats[endpoint];
      s.total += 1;
      if (!result.ok) {
        s.networkErr += 1;
        continue;
      }
      if (result.status >= 200 && result.status < 300) s.ok2xx += 1;
      else if (result.status >= 400 && result.status < 500) s.err4xx += 1;
      else if (result.status >= 500) s.err5xx += 1;
    }
  }

  console.log(JSON.stringify({ baseUrl: BASE_URL, rounds: ROUNDS, stats }, null, 2));

  const hasServerErrors = Object.values(stats).some((s) => s.err5xx > 0 || s.networkErr > 0);
  if (hasServerErrors) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
