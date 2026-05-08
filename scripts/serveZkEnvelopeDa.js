#!/usr/bin/env node

'use strict';

const express = require('express');

const ZkEnvelopeResolver = require('../src/zkEnvelopeResolver');

const DEFAULT_PORT = 8787;

function parseArgs(argv) {
  const out = {
    host: process.env.TL_ZK_DA_HOST || '127.0.0.1',
    port: Number(process.env.TL_ZK_DA_PORT || DEFAULT_PORT)
  };
  for (const arg of argv) {
    if (arg.startsWith('--host=')) out.host = arg.slice('--host='.length);
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice('--port='.length));
  }
  if (!Number.isInteger(out.port) || out.port <= 0) throw new Error(`invalid DA port: ${out.port}`);
  return out;
}

function envelopeParam(req) {
  const id = String(req.params.envelopeId || '').replace(/\.json$/i, '');
  return /^[0-9a-f]{64}$/i.test(id) ? id.toLowerCase() : '';
}

function createApp() {
  const app = express();

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      service: 'tl-zk-envelope-da',
      envelopeDirs: ZkEnvelopeResolver.defaultEnvelopeDirs()
    });
  });

  app.get(['/zk/envelopes/:envelopeId', '/zk/envelopes/:envelopeId.json', '/:envelopeId.json'], async (req, res) => {
    const envelopeId = envelopeParam(req);
    if (!envelopeId) {
      res.status(400).json({ ok: false, error: 'invalid envelope id' });
      return;
    }

    const resolved = await ZkEnvelopeResolver.resolveEnvelopeFromParams({
      envelopeId,
      envelopeRef: `zkda:${envelopeId}`
    });
    if (!resolved.envelope) {
      res.status(404).json({
        ok: false,
        envelopeId,
        error: resolved.error || 'envelope not found'
      });
      return;
    }

    res.json({
      kind: 'tlzk_envelope_da_record_v1',
      envelopeId,
      servedAt: new Date().toISOString(),
      source: resolved.source,
      envelope: resolved.envelope
    });
  });

  return app;
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const app = createApp();
  app.listen(config.port, config.host, () => {
    console.log(JSON.stringify({
      ok: true,
      service: 'tl-zk-envelope-da',
      baseUrl: `http://${config.host}:${config.port}/zk/envelopes`,
      health: `http://${config.host}:${config.port}/healthz`
    }, null, 2));
  });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  createApp
};
