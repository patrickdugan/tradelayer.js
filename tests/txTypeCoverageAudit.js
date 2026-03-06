const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const TYPES = path.join(ROOT, 'src', 'types.js');
const LOGIC = path.join(ROOT, 'src', 'logic.js');

function extractFunctionBody(content, anchorRegex) {
  const anchorMatch = content.match(anchorRegex);
  if (!anchorMatch) return '';
  const start = anchorMatch.index;
  const open = content.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(open, i + 1);
      }
    }
  }
  return '';
}

function parseCases(content, anchorRegex) {
  const slice = extractFunctionBody(content, anchorRegex);
  if (!slice) return [];
  const re = /case\s+(\d+)\s*:/g;
  const out = new Set();
  let m;
  while ((m = re.exec(slice)) !== null) {
    out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

function diff(a, b) {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
}

function main() {
  const typesSrc = fs.readFileSync(TYPES, 'utf8');
  const logicSrc = fs.readFileSync(LOGIC, 'utf8');

  const encodeCases = parseCases(typesSrc, /encodePayload\s*:\s*\(/);
  const decodeCases = parseCases(typesSrc, /decodePayload\s*:\s*async\s*\(/);
  const logicCases = parseCases(logicSrc, /async\s+typeSwitch\s*\(/);

  const logicMissingInEncode = diff(logicCases, encodeCases);
  const logicMissingInDecode = diff(logicCases, decodeCases);

  const report = {
    encodeCases,
    decodeCases,
    logicCases,
    logicMissingInEncode,
    logicMissingInDecode
  };

  console.log(JSON.stringify(report, null, 2));

  assert.deepStrictEqual(
    logicMissingInEncode,
    [],
    `Logic cases missing in encodePayload: ${logicMissingInEncode.join(',')}`
  );
  assert.deepStrictEqual(
    logicMissingInDecode,
    [],
    `Logic cases missing in decodePayload: ${logicMissingInDecode.join(',')}`
  );

  console.log('PASS tx type coverage audit');
}

main();
