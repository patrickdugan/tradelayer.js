/* tslint:disable */
/* eslint-disable */

export function verifier_limits_json(): string;

export function verify_checkpoint_announcement_json(announcement_json: string): string;

export function verify_stwo_cairo_proof_json(proof_json: string, channel_hash: string, expected_sha256_hex: string): string;

export function verify_zk_consensus_envelope_json(envelope_json: string): string;
