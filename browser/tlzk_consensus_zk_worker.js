'use strict';

/*
 * Consensus ZK worker template.
 *
 * Load the wasm-bindgen package from wasm/tlzk_verifier first and expose it
 * as self.TLZKVerifier. Consensus code can then post a ZK envelope and receive
 * the verifier result without blocking the UI or the Electron renderer.
 */

self.onmessage = event => {
  const { id, type, envelope } = event.data || {};
  try {
    if (type !== 'verify-zk-consensus-envelope') {
      throw new Error(`unsupported worker message: ${type}`);
    }
    if (!self.TLZKVerifier || typeof self.TLZKVerifier.verify_zk_consensus_envelope_json !== 'function') {
      throw new Error('TLZKVerifier WASM package is not loaded');
    }
    const result = JSON.parse(
      self.TLZKVerifier.verify_zk_consensus_envelope_json(JSON.stringify(envelope))
    );
    self.postMessage({
      id,
      type: 'verified-zk-consensus-envelope',
      ok: Boolean(result.ok),
      result
    });
  } catch (err) {
    self.postMessage({
      id,
      type: 'verified-zk-consensus-envelope',
      ok: false,
      result: {
        ok: false,
        reason: err.message
      }
    });
  }
};
