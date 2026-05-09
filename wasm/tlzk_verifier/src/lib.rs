use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

const ANNOUNCEMENT_DOMAIN: &str = "tlzk-checkpoint-announcement-v1";
const MAX_ANNOUNCEMENT_BYTES: usize = 256 * 1024;
const MAX_SYNC_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_ZK_ENVELOPE_BYTES: usize = 2 * 1024 * 1024;
const MAX_STWO_PROOF_BYTES: usize = 32 * 1024 * 1024;
const ED25519_SPKI_PREFIX_HEX: &str = "302a300506032b6570032100";

fn response(ok: bool, reason: &str) -> String {
    json!({ "ok": ok, "reason": reason }).to_string()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
        Value::String(v) => serde_json::to_string(v).expect("string serialization"),
        Value::Array(values) => {
            let inner = values.iter().map(canonical_json).collect::<Vec<_>>().join(",");
            format!("[{}]", inner)
        }
        Value::Object(map) => {
            let mut keys = map.keys().collect::<Vec<_>>();
            keys.sort();
            let inner = keys
                .iter()
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("key serialization"),
                        canonical_json(&map[*key])
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{}}}", inner)
        }
    }
}

fn get_path_string<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_str()
}

fn get_path_value<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    Some(cursor)
}

fn require_public_input(public_inputs: &Value, field: &str, expected: &str, reason: &str) -> Option<String> {
    match get_path_string(public_inputs, &[field]) {
        Some(value) if value == expected => None,
        Some(_) => Some(reason.to_string()),
        None => None,
    }
}

fn ed25519_key_from_spki_pem(pem: &str) -> Result<[u8; 32], String> {
    let body = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    let der = STANDARD
        .decode(body.as_bytes())
        .map_err(|err| format!("public key base64 decode failed: {}", err))?;
    if der.len() == 32 {
        let mut key = [0u8; 32];
        key.copy_from_slice(&der);
        return Ok(key);
    }
    let prefix = hex::decode(ED25519_SPKI_PREFIX_HEX).expect("static Ed25519 SPKI prefix");
    if der.len() == prefix.len() + 32 && der.starts_with(&prefix) {
        let mut key = [0u8; 32];
        key.copy_from_slice(&der[prefix.len()..]);
        return Ok(key);
    }
    Err("unsupported Ed25519 public key encoding".to_string())
}

#[wasm_bindgen]
pub fn verifier_limits_json() -> String {
    json!({
        "maxAnnouncementBytes": MAX_ANNOUNCEMENT_BYTES,
        "maxSyncBundleBytes": MAX_SYNC_BUNDLE_BYTES,
        "maxZkEnvelopeBytes": MAX_ZK_ENVELOPE_BYTES,
        "maxStwoProofBytes": MAX_STWO_PROOF_BYTES,
        "signatureAlgorithm": "ed25519",
        "hash": "sha256",
        "canonicalJson": "sorted-object-keys",
        "embeddedStwo": cfg!(feature = "embedded-stwo")
    })
    .to_string()
}

fn hash_value(value: &Value) -> String {
    sha256_hex(canonical_json(value).as_bytes())
}

fn get_path_bool(value: &Value, path: &[&str]) -> Option<bool> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_bool()
}

#[wasm_bindgen]
pub fn verify_zk_consensus_envelope_json(envelope_json: &str) -> String {
    if envelope_json.len() > MAX_ZK_ENVELOPE_BYTES {
        return response(false, "ZK consensus envelope exceeds deterministic memory limit");
    }

    let envelope: Value = match serde_json::from_str(envelope_json) {
        Ok(value) => value,
        Err(err) => return response(false, &format!("invalid ZK envelope JSON: {}", err)),
    };
    if get_path_string(&envelope, &["kind"]) != Some("tlzk_zk_consensus_envelope") {
        return response(false, "wrong ZK consensus envelope kind");
    }
    let core = match envelope.get("envelopeCore") {
        Some(value) => value,
        None => return response(false, "missing ZK envelope core"),
    };
    if get_path_string(core, &["protocol"]) != Some("tlzk_zk_consensus_envelope_v1") {
        return response(false, "wrong ZK consensus envelope protocol");
    }

    let envelope_id = hash_value(core);
    if get_path_string(&envelope, &["envelopeId"]) != Some(envelope_id.as_str()) {
        return response(false, "ZK consensus envelope id mismatch");
    }
    let public_inputs = match core.get("publicInputs") {
        Some(value) => value,
        None => return response(false, "missing ZK public inputs"),
    };
    let public_input_hash = hash_value(public_inputs);
    if get_path_string(core, &["publicInputHash"]) != Some(public_input_hash.as_str()) {
        return response(false, "ZK public input hash mismatch");
    }

    if get_path_string(core, &["movementRoot"]) != get_path_string(public_inputs, &["movementRoot"]) {
        return response(false, "ZK movement root public input mismatch");
    }
    if get_path_string(core, &["signedL1Tx", "hash"]) != get_path_string(public_inputs, &["signedL1TxHash"]) {
        return response(false, "signed L1 transaction public input mismatch");
    }
    if get_path_string(core, &["batchL2Tx", "hash"]) != get_path_string(public_inputs, &["batchL2TxHash"]) {
        return response(false, "batch L2 transaction public input mismatch");
    }
    let signed_l1_hex = match get_path_string(core, &["signedL1Tx", "hex"]) {
        Some(value) => value,
        None => return response(false, "missing signed L1 transaction hex"),
    };
    if sha256_hex(signed_l1_hex.as_bytes()) != get_path_string(core, &["signedL1Tx", "hash"]).unwrap_or("") {
        return response(false, "signed L1 transaction hash mismatch");
    }
    let batch_l2_hex = match get_path_string(core, &["batchL2Tx", "hex"]) {
        Some(value) => value,
        None => return response(false, "missing batch L2 transaction hex"),
    };
    if sha256_hex(batch_l2_hex.as_bytes()) != get_path_string(core, &["batchL2Tx", "hash"]).unwrap_or("") {
        return response(false, "batch L2 transaction hash mismatch");
    }

    let result = match envelope.get("verifierResult") {
        Some(value) => value,
        None => return response(false, "missing ZK verifier result"),
    };
    if get_path_string(result, &["kind"]) != Some("tlzk_zk_verifier_result") {
        return response(false, "wrong ZK verifier result kind");
    }
    let result_core = match result.get("resultCore") {
        Some(value) => value,
        None => return response(false, "missing ZK verifier result core"),
    };
    let result_id = hash_value(result_core);
    if get_path_string(result, &["resultId"]) != Some(result_id.as_str()) {
        return response(false, "ZK verifier result id mismatch");
    }
    if get_path_bool(result_core, &["ok"]) != Some(true) {
        return response(false, "ZK verifier result is not ok");
    }
    if get_path_string(result_core, &["envelopeId"]) != Some(envelope_id.as_str()) {
        return response(false, "ZK verifier result envelope mismatch");
    }
    if get_path_string(result_core, &["verifierId"]) != get_path_string(core, &["verifierId"]) {
        return response(false, "ZK verifier result verifier mismatch");
    }
    if get_path_string(result_core, &["proofType"]) != get_path_string(core, &["proofType"]) {
        return response(false, "ZK verifier result proof type mismatch");
    }
    if get_path_string(result_core, &["proofHash"]) != get_path_string(core, &["proofHash"]) {
        return response(false, "ZK verifier result proof hash mismatch");
    }
    if get_path_string(result_core, &["programHash"]) != get_path_string(core, &["programHash"]) {
        return response(false, "ZK verifier result program hash mismatch");
    }
    if get_path_string(result_core, &["publicInputHash"]) != Some(public_input_hash.as_str()) {
        return response(false, "ZK verifier result public input mismatch");
    }
    if get_path_string(result_core, &["daBlobHash"]) != get_path_string(public_inputs, &["daBlobHash"]) {
        return response(false, "ZK verifier result DA blob mismatch");
    }

    if let Some(da_value) = get_path_value(core, &["daBlob", "value"]) {
        if let Some(batch) = da_value.get("signedChannelTransferBatch") {
            let batch_hash = hash_value(batch);
            if let Some(reason) = require_public_input(
                public_inputs,
                "signedChannelTransferBatchHash",
                &batch_hash,
                "signed channel transfer batch hash mismatch",
            ) {
                return response(false, &reason);
            }
            if let Some(signature_root) = get_path_string(batch, &["batchCore", "signatureRoot"]) {
                if let Some(reason) = require_public_input(
                    public_inputs,
                    "channelSignatureRoot",
                    signature_root,
                    "signed channel transfer signature root mismatch",
                ) {
                    return response(false, &reason);
                }
            }
        }

        if let Some(intent) = da_value.get("channelPathIntent") {
            let intent_hash = hash_value(intent);
            if let Some(reason) = require_public_input(
                public_inputs,
                "channelPathIntentHash",
                &intent_hash,
                "channel path intent hash mismatch",
            ) {
                return response(false, &reason);
            }
        }

        if let Some(transcript) = da_value.get("channelPathSigningTranscript") {
            let transcript_hash = hash_value(transcript);
            if let Some(reason) = require_public_input(
                public_inputs,
                "channelPathSigningTranscriptHash",
                &transcript_hash,
                "channel path signing transcript hash mismatch",
            ) {
                return response(false, &reason);
            }
        }

        if let Some(execution) = da_value.get("signedChannelTransferExecution") {
            let execution_hash = hash_value(execution);
            if let Some(reason) = require_public_input(
                public_inputs,
                "signedChannelTransferExecutionHash",
                &execution_hash,
                "signed channel transfer execution hash mismatch",
            ) {
                return response(false, &reason);
            }
            let execution_core = match execution.get("executionCore") {
                Some(value) => value,
                None => return response(false, "missing signed channel transfer execution core"),
            };
            let execution_checks = [
                ("channelInputStateRoot", "inputStateRoot", "channel input state root mismatch"),
                ("channelOutputStateRoot", "outputStateRoot", "channel output state root mismatch"),
                (
                    "channelBalanceTransitionRoot",
                    "balanceTransitionRoot",
                    "channel balance transition root mismatch",
                ),
                ("channelStepRoot", "stepRoot", "channel step root mismatch"),
                ("channelDescendantRoot", "descendantRoot", "channel descendant root mismatch"),
                ("channelAuthorizationRoot", "authorizationRoot", "channel authorization root mismatch"),
                ("channelConservationRoot", "conservationRoot", "channel conservation root mismatch"),
            ];
            for (public_field, execution_field, reason) in execution_checks {
                if let Some(expected) = get_path_string(execution_core, &[execution_field]) {
                    if let Some(reason) = require_public_input(public_inputs, public_field, expected, reason) {
                        return response(false, &reason);
                    }
                }
            }
        }
    }

    json!({
        "ok": true,
        "envelopeId": envelope_id,
        "verifierId": get_path_string(core, &["verifierId"]).unwrap_or(""),
        "proofType": get_path_string(core, &["proofType"]).unwrap_or(""),
        "resultId": result_id
    })
    .to_string()
}

#[cfg(feature = "embedded-stwo")]
mod embedded_stwo {
    use cairo_air::verifier::verify_cairo;
    use cairo_air::CairoProofForRustVerifier;
    use stwo::core::vcs_lifted::blake2_merkle::{
        Blake2sM31MerkleChannel, Blake2sM31MerkleHasher, Blake2sMerkleChannel, Blake2sMerkleHasher,
    };

    #[cfg(not(target_arch = "wasm32"))]
    use stwo::core::vcs_lifted::poseidon252_merkle::{
        Poseidon252MerkleChannel, Poseidon252MerkleHasher,
    };

    fn verify_blake2s(proof_json: &str) -> Result<(), String> {
        let proof: CairoProofForRustVerifier<Blake2sMerkleHasher> =
            serde_json::from_str(proof_json).map_err(|err| format!("STWO proof JSON decode failed: {}", err))?;
        verify_cairo::<Blake2sMerkleChannel>(proof)
            .map_err(|err| format!("STWO proof verification failed: {:?}", err))
    }

    fn verify_blake2s_m31(proof_json: &str) -> Result<(), String> {
        let proof: CairoProofForRustVerifier<Blake2sM31MerkleHasher> =
            serde_json::from_str(proof_json).map_err(|err| format!("STWO proof JSON decode failed: {}", err))?;
        verify_cairo::<Blake2sM31MerkleChannel>(proof)
            .map_err(|err| format!("STWO proof verification failed: {:?}", err))
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn verify_poseidon252(proof_json: &str) -> Result<(), String> {
        let proof: CairoProofForRustVerifier<Poseidon252MerkleHasher> =
            serde_json::from_str(proof_json).map_err(|err| format!("STWO proof JSON decode failed: {}", err))?;
        verify_cairo::<Poseidon252MerkleChannel>(proof)
            .map_err(|err| format!("STWO proof verification failed: {:?}", err))
    }

    pub fn verify(proof_json: &str, channel_hash: &str) -> Result<(), String> {
        match channel_hash.to_ascii_lowercase().as_str() {
            "blake2s" => verify_blake2s(proof_json),
            "blake2s_m31" => verify_blake2s_m31(proof_json),
            #[cfg(not(target_arch = "wasm32"))]
            "poseidon252" => verify_poseidon252(proof_json),
            #[cfg(target_arch = "wasm32")]
            "poseidon252" => Err("poseidon252 STWO verifier is not compiled for wasm32".to_string()),
            other => Err(format!("unsupported STWO channel hash: {}", other)),
        }
    }
}

#[cfg(not(feature = "embedded-stwo"))]
mod embedded_stwo {
    pub fn verify(_proof_json: &str, _channel_hash: &str) -> Result<(), String> {
        Err("embedded-stwo feature is not enabled in this verifier WASM".to_string())
    }
}

#[wasm_bindgen]
pub fn verify_stwo_cairo_proof_json(
    proof_json: &str,
    channel_hash: &str,
    expected_sha256_hex: &str,
) -> String {
    if proof_json.len() > MAX_STWO_PROOF_BYTES {
        return response(false, "STWO proof exceeds deterministic memory limit");
    }
    let observed_hash = sha256_hex(proof_json.as_bytes());
    let expected_hash = expected_sha256_hex.trim().to_ascii_lowercase();
    if !expected_hash.is_empty() && observed_hash != expected_hash {
        return json!({
            "ok": false,
            "mode": "rust-wasm-embedded-stwo",
            "reason": "STWO proof hash mismatch",
            "observedHash": observed_hash,
            "expectedHash": expected_hash
        })
        .to_string();
    }

    match embedded_stwo::verify(proof_json, channel_hash) {
        Ok(()) => json!({
            "ok": true,
            "mode": "rust-wasm-embedded-stwo",
            "proofHash": observed_hash,
            "channelHash": channel_hash,
            "feature": "embedded-stwo"
        })
        .to_string(),
        Err(err) => json!({
            "ok": false,
            "mode": "rust-wasm-embedded-stwo",
            "proofHash": observed_hash,
            "channelHash": channel_hash,
            "reason": err
        })
        .to_string(),
    }
}

#[wasm_bindgen]
pub fn verify_checkpoint_announcement_json(announcement_json: &str) -> String {
    if announcement_json.len() > MAX_ANNOUNCEMENT_BYTES {
        return response(false, "announcement exceeds deterministic memory limit");
    }

    let announcement: Value = match serde_json::from_str(announcement_json) {
        Ok(value) => value,
        Err(err) => return response(false, &format!("invalid announcement JSON: {}", err)),
    };

    if get_path_string(&announcement, &["kind"]) != Some("tlzk_checkpoint_announcement") {
        return response(false, "wrong announcement kind");
    }

    let core = match announcement.get("announcementCore") {
        Some(value) => value,
        None => return response(false, "missing announcement core"),
    };
    let announcement_id = sha256_hex(canonical_json(core).as_bytes());
    if get_path_string(&announcement, &["announcementId"]) != Some(announcement_id.as_str()) {
        return response(false, "announcement id mismatch");
    }
    if get_path_string(&announcement, &["signature", "announcementId"]) != Some(announcement_id.as_str()) {
        return response(false, "signature announcement id mismatch");
    }
    if get_path_string(&announcement, &["signature", "algorithm"]) != Some("ed25519") {
        return response(false, "unsupported signature algorithm");
    }
    if get_path_string(&announcement, &["signature", "domain"]) != Some(ANNOUNCEMENT_DOMAIN) {
        return response(false, "signature domain mismatch");
    }

    let public_key_pem = match get_path_string(core, &["runner", "publicKeyPem"]) {
        Some(value) => value,
        None => return response(false, "missing runner public key"),
    };
    let public_key_bytes = match ed25519_key_from_spki_pem(public_key_pem) {
        Ok(value) => value,
        Err(err) => return response(false, &err),
    };
    let public_key = match VerifyingKey::from_bytes(&public_key_bytes) {
        Ok(value) => value,
        Err(err) => return response(false, &format!("invalid Ed25519 public key: {}", err)),
    };

    let signature_base64 = match get_path_string(&announcement, &["signature", "signatureBase64"]) {
        Some(value) => value,
        None => return response(false, "missing signature"),
    };
    let signature_bytes = match STANDARD.decode(signature_base64.as_bytes()) {
        Ok(value) => value,
        Err(err) => return response(false, &format!("signature base64 decode failed: {}", err)),
    };
    let signature = match Signature::from_slice(&signature_bytes) {
        Ok(value) => value,
        Err(err) => return response(false, &format!("invalid Ed25519 signature: {}", err)),
    };

    let message = format!("{}:{}", ANNOUNCEMENT_DOMAIN, announcement_id);
    match public_key.verify(message.as_bytes(), &signature) {
        Ok(_) => json!({
            "ok": true,
            "announcementId": announcement_id,
            "checkpointId": get_path_string(core, &["checkpointId"]).unwrap_or("")
        })
        .to_string(),
        Err(err) => response(false, &format!("signature verification failed: {}", err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_latest_checkpoint_announcement_fixture() {
        let fixture = include_str!("../../../artifacts/tl_state_checkpoints/announcement_latest.json");
        let result: Value =
            serde_json::from_str(&verify_checkpoint_announcement_json(fixture)).expect("result JSON");
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn verifies_latest_zk_consensus_envelope_fixture() {
        let fixture = include_str!("../../../artifacts/zk_consensus/zk_batch_movement_latest.json");
        let demo: Value = serde_json::from_str(fixture).expect("demo JSON");
        let envelope = serde_json::to_string(&demo["envelope"]).expect("envelope JSON");
        let result: Value =
            serde_json::from_str(&verify_zk_consensus_envelope_json(&envelope)).expect("result JSON");
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn stwo_proof_export_fails_closed_without_hash_match() {
        let result: Value = serde_json::from_str(&verify_stwo_cairo_proof_json(
            "{\"not\":\"a real proof\"}",
            "blake2s",
            &sha256_hex(b"different proof"),
        ))
        .expect("result JSON");
        assert_eq!(result["ok"], false);
        assert_eq!(result["reason"], "STWO proof hash mismatch");
    }
}
