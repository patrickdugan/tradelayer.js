const path = require('path');
const Base256 = require(path.join(__dirname, '../src/base256.js'));

// Helpers
const hexToBuf = h => Buffer.from(h, 'hex');
const bufToHex = b => Buffer.from(b).toString('hex');
const pad64 = h => (h.length >= 64 ? h.slice(-64) : '0'.repeat(64 - h.length) + h);

function buildScript(tx1HexBE, tx2HexBE) {
  // encode to your base-256 "printable" alphabet (multi-byte UTF-8)
  const s1 = Base256.hexToBase256(tx1HexBE.toLowerCase());
  const s2 = Base256.hexToBase256(tx2HexBE.toLowerCase());

  const b1 = Buffer.from(s1, 'utf8');
  const b2 = Buffer.from(s2, 'utf8');

  if (b1.length > 255 || b2.length > 255) {
    throw new Error(`Base256 UTF-8 is too long for 1-byte length fields: b1=${b1.length}, b2=${b2.length}`);
  }

  // 'tl' + tag(0x42) + len1 + len2 + data1 + data2
  const header = Buffer.from([0x74, 0x6c, 0x42, b1.length, b2.length]);
  const payload = Buffer.concat([header, b1, b2]);

  // Minimal push wrapper
  const len = payload.length;
  let script;
  if (len <= 75) {
    script = Buffer.concat([Buffer.from([0x6a, len]), payload]);
  } else if (len <= 0xff) {
    script = Buffer.concat([Buffer.from([0x6a, 0x4c, len]), payload]); // PUSHDATA1
  } else if (len <= 0xffff) {
    script = Buffer.concat([Buffer.from([0x6a, 0x4d, len & 0xff, len >> 8]), payload]); // PUSHDATA2
  } else {
    const L = Buffer.allocUnsafe(4); L.writeUInt32LE(len, 0);
    script = Buffer.concat([Buffer.from([0x6a, 0x4e]), L, payload]); // PUSHDATA4
  }
  return bufToHex(script);
}

function parseScript(scriptHex) {
  const buf = hexToBuf(scriptHex);
  if (buf[0] !== 0x6a) throw new Error('Not OP_RETURN');

  const op = buf[1];
  let len, off;
  if (op <= 75)       { len = op; off = 2; }
  else if (op === 0x4c){ len = buf[2]; off = 3; }
  else if (op === 0x4d){ len = buf[2] | (buf[3] << 8); off = 4; }
  else if (op === 0x4e){ len = (buf[2] | (buf[3] << 8) | (buf[4] << 16) | (buf[5] << 24)) >>> 0; off = 6; }
  else throw new Error('Unknown pushdata');

  const data = buf.slice(off, off + len);
  if (data[0] !== 0x74 || data[1] !== 0x6c) throw new Error('Missing "tl"');
  if (data[2] !== 0x42) throw new Error('Unexpected tag (expected 0x42)');

  const len1 = data[3], len2 = data[4];
  if (5 + len1 + len2 !== data.length) throw new Error('Length mismatch');

  const s1 = data.slice(5, 5 + len1).toString('utf8');
  const s2 = data.slice(5 + len1, 5 + len1 + len2).toString('utf8');

  const h1 = pad64(Base256.base256ToHex(s1).toLowerCase());
  const h2 = pad64(Base256.base256ToHex(s2).toLowerCase());

  return { txid1: h1, txid2: h2, payloadLen: len, scriptLen: buf.length };
}

// ---- demo ----
const TX1 = 'e2b11900c8e99d77bc527807c268bd937a991d975d7a6043725f4174e1fcc6a7';
const TX2 = 'acb58f122e0ffa34e82b3775289ef55218243d3712fb592f1ac70bdec8984e7c';

const scriptHex = buildScript(TX1, TX2);
console.log('ScriptPubKey (hex):', scriptHex); // log hex only (no beeps)

const parsed = parseScript(scriptHex);
console.log('Parsed:', parsed);

if (parsed.txid1 !== TX1 || parsed.txid2 !== TX2) {
  throw new Error('Round-trip mismatch');
}
console.log('Round-trip OK.');
