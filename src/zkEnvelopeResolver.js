'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

function parseEnvelopeRecord(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.kind === 'tlzk_zk_consensus_envelope' && value.envelopeCore) return value;
    if (value.envelope && value.envelope.kind === 'tlzk_zk_consensus_envelope') return value.envelope;
    if (value.zkEnvelope && value.zkEnvelope.kind === 'tlzk_zk_consensus_envelope') return value.zkEnvelope;
    return null;
}

function readJsonEnvelope(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parseEnvelopeRecord(parsed);
}

function defaultEnvelopeDirs() {
    const configured = String(process.env.TL_ZK_ENVELOPE_DIRS || process.env.TL_ZK_ENVELOPE_DIR || '').trim();
    if (configured) {
        return configured.split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry));
    }
    return [
        path.join(repoRoot, 'artifacts', 'zk_envelopes'),
        path.join(repoRoot, 'artifacts', 'zk_signed_channel_transfer'),
        path.join(repoRoot, 'artifacts', 'zk_consensus')
    ];
}

function candidatePathsForRef(envelopeRef, envelopeId) {
    const roots = defaultEnvelopeDirs();
    const ref = String(envelopeRef || '').trim();
    const id = String(envelopeId || '').trim();
    const candidates = [];

    if (ref.startsWith('file:')) {
        const rawPath = ref.slice('file:'.length);
        candidates.push(path.isAbsolute(rawPath) ? rawPath : path.resolve(repoRoot, rawPath));
    } else if (ref && !/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
        for (const root of roots) {
            candidates.push(path.resolve(root, ref));
            candidates.push(path.resolve(root, `${ref}.json`));
        }
    }

    const lookupId = ref.startsWith('zkda:') ? ref.slice('zkda:'.length) : id;
    if (/^[0-9a-f]{64}$/i.test(lookupId)) {
        for (const root of roots) {
            candidates.push(path.resolve(root, `${lookupId}.json`));
            candidates.push(path.resolve(root, `${lookupId}.envelope.json`));
            candidates.push(path.resolve(root, `tx34_${lookupId}.json`));
            candidates.push(path.resolve(root, `zk_envelope_${lookupId}.json`));
        }
    }

    return [...new Set(candidates)];
}

function fetchJson(url) {
    const client = url.startsWith('https:') ? https : http;
    const timeoutMs = Number(process.env.TL_ZK_DA_HTTP_TIMEOUT_MS || 5000);

    return new Promise((resolve, reject) => {
        const request = client.get(url, { timeout: timeoutMs }, (response) => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (err) {
                    reject(err);
                }
            });
        });
        request.on('timeout', () => {
            request.destroy(new Error(`timed out after ${timeoutMs}ms`));
        });
        request.on('error', reject);
    });
}

function allowHttpDa() {
    return String(process.env.TL_ZK_DA_ALLOW_HTTP || '').trim() === '1';
}

function remoteUrlForEnvelopeId(envelopeId, baseUrl = process.env.TL_ZK_DA_BASE_URL) {
    const id = String(envelopeId || '').trim();
    const base = String(baseUrl || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(id) || !base) return '';
    if (base.includes('{id}')) return base.replace(/\{id\}/g, id);
    return `${base.replace(/\/+$/, '')}/${id}.json`;
}

async function fetchHttpEnvelope(url) {
    if (!allowHttpDa()) {
        return { envelope: null, source: url, error: 'HTTP ZK envelope DA is disabled unless TL_ZK_DA_ALLOW_HTTP=1' };
    }
    try {
        const envelope = parseEnvelopeRecord(await fetchJson(url));
        if (!envelope) return { envelope: null, source: url, error: 'HTTP response did not contain a ZK envelope' };
        return { envelope, source: url };
    } catch (err) {
        return { envelope: null, source: url, error: `HTTP ZK envelope fetch failed: ${err.message}` };
    }
}

async function resolveEnvelopeFromParams(params = {}) {
    if (params.zkEnvelope || params.envelope) {
        return { envelope: params.zkEnvelope || params.envelope, source: 'direct' };
    }

    if (params.envelopeB64 && String(params.envelopeB64).startsWith('b64:')) {
        try {
            const decoded = JSON.parse(Buffer.from(String(params.envelopeB64).slice(4), 'base64').toString('utf8'));
            const envelope = parseEnvelopeRecord(decoded);
            if (!envelope) return { envelope: null, source: 'embedded-b64', error: 'embedded payload did not contain a ZK envelope' };
            return { envelope, source: 'embedded-b64' };
        } catch (err) {
            return { envelope: null, source: 'embedded-b64', error: `invalid embedded ZK envelope: ${err.message}` };
        }
    }

    const envelopeRef = String(params.envelopeRef || params.daRef || '').trim();
    const attempts = [];

    if (/^https?:\/\//i.test(envelopeRef)) {
        return fetchHttpEnvelope(envelopeRef);
    }

    for (const candidate of candidatePathsForRef(envelopeRef, params.envelopeId)) {
        attempts.push(candidate);
        if (!fs.existsSync(candidate)) continue;
        try {
            const envelope = readJsonEnvelope(candidate);
            if (!envelope) return { envelope: null, source: candidate, error: 'DA file did not contain a ZK envelope' };
            return { envelope, source: candidate, attempts };
        } catch (err) {
            return { envelope: null, source: candidate, attempts, error: `ZK envelope DA read failed: ${err.message}` };
        }
    }

    const remoteUrl = remoteUrlForEnvelopeId(params.envelopeId);
    if (remoteUrl) {
        const remote = await fetchHttpEnvelope(remoteUrl);
        return { ...remote, attempts };
    }

    return { envelope: null, source: envelopeRef || 'local-da', attempts };
}

function writeLocalEnvelopeRecord(envelope, outputDir = path.join(repoRoot, 'artifacts', 'zk_envelopes')) {
    if (!envelope || !envelope.envelopeId) throw new Error('cannot write ZK envelope record without envelopeId');
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `${envelope.envelopeId}.json`);
    const record = {
        kind: 'tlzk_envelope_da_record_v1',
        envelopeId: envelope.envelopeId,
        writtenAt: new Date().toISOString(),
        envelope
    };
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
    return filePath;
}

module.exports = {
    parseEnvelopeRecord,
    defaultEnvelopeDirs,
    candidatePathsForRef,
    remoteUrlForEnvelopeId,
    resolveEnvelopeFromParams,
    writeLocalEnvelopeRecord
};
