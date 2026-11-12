//! The remote link: a linked browser reading the library over WebRTC.

pub mod bytes;
pub mod digest;
pub mod pairing;
pub mod peer;
pub mod protocol;
pub mod service;
pub mod stun;

/// Install the crypto the WebRTC stack uses, once per process.
pub(crate) fn install_crypto() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| str0m::crypto::from_feature_flags().install_process_default());
}

/// An opaque id two peers meet under at the relay: 22 to 128 characters of
/// URL-safe base64, the rule the relay itself holds.
pub fn is_room_id(id: &str) -> bool {
    (22..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
