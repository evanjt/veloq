//! The link's test vectors: fixed inputs and the bytes the engine derives
//! from them, for a client in another language to check its own derivations
//! against.

use super::pairing::{Role, fingerprint_of, proof, room_for};
use super::protocol::{GZIP_OVER, frames};
use serde_json::json;

const BROWSER_FINGERPRINT: &str = "sha-256 AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";
const PHONE_FINGERPRINT: &str = "sha-256 BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB";
const SHORT_REPLY: &str = r#"{"id":7,"ok":true,"result":"short"}"#;
/// Not a certificate, only bytes to hash: the fingerprint is a hash of any.
const CERTIFICATE: [u8; 16] = *b"vectors-cert-der";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A reply over [`GZIP_OVER`], so its frames carry a gzip stream.
fn long_reply() -> String {
    format!(
        r#"{{"id":9,"ok":true,"result":"{}"}}"#,
        "a".repeat(GZIP_OVER + 1000)
    )
}

/// The text of `examples/link/vectors.json`.
pub fn vectors_json() -> String {
    let secret = [7u8; 32];
    let long = long_reply();
    let frames_hex =
        |reply: &str| -> Vec<String> { frames(reply).iter().map(|frame| hex(frame)).collect() };
    let mut text = serde_json::to_string_pretty(&json!({
        "note": "Outputs are hex except room and fingerprint. A gzip stream differs between \
                 libraries, so a client compares longFrames by joining the frame bodies, \
                 gunzipping them and comparing the text to inputs.longReply.",
        "inputs": {
            "browserFingerprint": BROWSER_FINGERPRINT,
            "phoneFingerprint": PHONE_FINGERPRINT,
            "secretHex": hex(&secret),
            "certificateHex": hex(&CERTIFICATE),
            "shortReply": SHORT_REPLY,
            "longReply": long,
        },
        "outputs": {
            "room": room_for(&secret, BROWSER_FINGERPRINT, PHONE_FINGERPRINT),
            "browserProof": hex(&proof(&secret, Role::Browser, BROWSER_FINGERPRINT, PHONE_FINGERPRINT)),
            "phoneProof": hex(&proof(&secret, Role::Phone, BROWSER_FINGERPRINT, PHONE_FINGERPRINT)),
            "fingerprint": fingerprint_of(&CERTIFICATE),
            "shortFrames": frames_hex(SHORT_REPLY),
            "longFrames": frames_hex(&long),
        },
    }))
    .expect("a table of strings serialises");
    text.push('\n');
    text
}
