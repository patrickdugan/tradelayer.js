/* tslint:disable */
/* eslint-disable */

export function verifier_limits_json(): string;

export function verify_checkpoint_announcement_json(announcement_json: string): string;

export function verify_stwo_cairo_proof_json(proof_json: string, channel_hash: string, expected_sha256_hex: string): string;

export function verify_zk_consensus_envelope_json(envelope_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly verifier_limits_json: () => [number, number];
    readonly verify_checkpoint_announcement_json: (a: number, b: number) => [number, number];
    readonly verify_stwo_cairo_proof_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly verify_zk_consensus_envelope_json: (a: number, b: number) => [number, number];
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzBuffToBuffCompress: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzBuffToBuffDecompress: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzCompress: (a: number, b: number) => number;
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzCompressEnd: (a: number) => number;
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzCompressInit: (a: number, b: number, c: number, d: number) => number;
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzDecompress: (a: number) => number;
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzDecompressEnd: (a: number) => number;
    readonly LIBBZ2_RS_SYS_v0.1.x_BZ2_bzDecompressInit: (a: number, b: number, c: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
