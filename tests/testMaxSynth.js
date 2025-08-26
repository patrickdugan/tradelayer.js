// queryMaxSynth.js
// Usage: node queryMaxSynth.js
const http = require('http');
const querystring = require('querystring');

const HOST = process.env.HOST || 'localhost';
const PORT = Number(process.env.PORT || 3000);

// target params
const address = 'tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t';
const propertyId = '1';

const qs = querystring.stringify({ address, propertyId });

const options = {
  hostname: HOST,
  port: PORT,
  path: `/tl_getMaxSynth?${qs}`,
  method: 'GET',
  headers: { 'Accept': 'application/json' },
};

const req = http.request(options, (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    try {
      const json = JSON.parse(body);
      console.log('Status:', res.statusCode);
      console.dir(json, { depth: null });
    } catch (e) {
      console.error('Non-JSON response:', body);
      process.exitCode = 1;
    }
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
  process.exitCode = 1;
});

req.end();
