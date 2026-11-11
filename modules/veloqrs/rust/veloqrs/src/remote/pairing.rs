//! Pairing: how a browser becomes linked.
//!
//! The browser shows a QR code holding a room id, a one-time secret, its own
//! certificate fingerprint and an expiry. The phone scans it, the browser
//! connects, and each side proves it holds the secret with an HMAC over both
//! certificates. A relay that swapped either certificate cannot make a proof
//! that verifies. The secret is spent on its first use, good or bad, and an
//! invitation lasts at most two minutes. The athlete then confirms on the
//! phone, and only then is the browser pinned.

use std::collections::HashSet;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use subtle::ConstantTimeEq;

use crate::remote::digest::{hmac_sha256, sha256};

/// The longest an invitation lasts, whatever the QR code says.
pub const PAIRING_TTL_SECS: i64 = 120;

const SECRET_BYTES: usize = 32;

/// Why a pairing was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairingRefusal {
    Malformed,
    Expired,
    Spent,
    /// Another certificate than the QR code named connected.
    WrongBrowser,
    BadProof,
}

/// Which side a proof is made by, so one side's proof never verifies as the
/// other's.
#[derive(Debug, Clone, Copy)]
pub enum Role {
    Browser,
    Phone,
}

/// A scanned QR code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invitation {
    pub room: String,
    pub secret: [u8; SECRET_BYTES],
    /// The browser's certificate fingerprint, in the spelling pins use.
    pub browser: String,
    pub expires_at: i64,
}

#[derive(Deserialize)]
struct Scanned {
    v: u32,
    room: String,
    secret: String,
    fp: String,
    exp: i64,
}

/// The secret as a QR code carries it.
pub fn encode_secret(secret: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(secret)
}

fn spelled(fingerprint: &str) -> Option<String> {
    let (hash, hex) = fingerprint.trim().split_once(' ')?;
    Some(format!(
        "{} {}",
        hash.to_ascii_lowercase(),
        hex.trim().to_ascii_uppercase()
    ))
}

impl Invitation {
    /// Read a QR code scanned at `now`. Its expiry is cut to the cap.
    pub fn parse(qr: &str, now: i64) -> Result<Self, PairingRefusal> {
        let scanned: Scanned = serde_json::from_str(qr).map_err(|_| PairingRefusal::Malformed)?;
        if scanned.v != 1 || !crate::remote::is_room_id(&scanned.room) {
            return Err(PairingRefusal::Malformed);
        }
        let secret: [u8; SECRET_BYTES] = URL_SAFE_NO_PAD
            .decode(scanned.secret.as_bytes())
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or(PairingRefusal::Malformed)?;
        let browser = spelled(&scanned.fp).ok_or(PairingRefusal::Malformed)?;
        if scanned.exp <= now {
            return Err(PairingRefusal::Expired);
        }
        Ok(Self {
            room: scanned.room,
            secret,
            browser,
            expires_at: scanned.exp.min(now + PAIRING_TTL_SECS),
        })
    }
}

/// A field's length as the four big-endian bytes that prefix it.
fn length_prefix(field: &[u8]) -> [u8; 4] {
    (field.len() as u32).to_be_bytes()
}

/// The proof one side sends: an HMAC under the secret over its role and both
/// certificate fingerprints, each field behind its length.
pub fn proof(secret: &[u8; SECRET_BYTES], role: Role, browser: &str, phone: &str) -> [u8; 32] {
    let role: &[u8] = match role {
        Role::Browser => b"browser",
        Role::Phone => b"phone",
    };
    hmac_sha256(
        secret,
        &[
            &length_prefix(role),
            role,
            &length_prefix(browser.as_bytes()),
            browser.as_bytes(),
            &length_prefix(phone.as_bytes()),
            phone.as_bytes(),
        ],
    )
}

/// The room a linked browser and the phone meet in to reconnect: a hash of
/// both fingerprints, each length-prefixed. The web page repeats this
/// derivation, so the bytes hashed never change.
pub fn room_for(browser: &str, phone: &str) -> String {
    let digest = sha256(&[
        b"veloq link room",
        &length_prefix(browser.as_bytes()),
        browser.as_bytes(),
        &length_prefix(phone.as_bytes()),
        phone.as_bytes(),
    ]);
    URL_SAFE_NO_PAD.encode(digest)
}

/// A certificate's fingerprint in the spelling pins use, from its DER bytes.
pub fn fingerprint_of(certificate: &[u8]) -> String {
    let hex: Vec<String> = sha256(&[certificate])
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect();
    format!("sha-256 {}", hex.join(":"))
}

/// Decide a browser's proof. `presented` is the certificate the browser's
/// connection presented and `phone` the phone's own. The secret is spent
/// whatever the outcome, so a wrong guess cannot be followed by another.
pub fn verify(
    invitation: &Invitation,
    presented: &str,
    phone: &str,
    browser_proof: &[u8],
    now: i64,
    spent: &mut HashSet<[u8; SECRET_BYTES]>,
) -> Result<(), PairingRefusal> {
    if !spent.insert(invitation.secret) {
        return Err(PairingRefusal::Spent);
    }
    if now > invitation.expires_at {
        return Err(PairingRefusal::Expired);
    }
    if spelled(presented).as_deref() != Some(invitation.browser.as_str()) {
        return Err(PairingRefusal::WrongBrowser);
    }
    let expected = proof(
        &invitation.secret,
        Role::Browser,
        &invitation.browser,
        phone,
    );
    if bool::from(expected.as_slice().ct_eq(browser_proof)) {
        Ok(())
    } else {
        Err(PairingRefusal::BadProof)
    }
}

/// The longest name a browser may give itself.
const MAX_NAME_CHARS: usize = 64;

/// Where one pairing stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stage {
    /// Scanned; the browser has not proved the secret yet.
    Invited,
    /// Proved; the athlete has not answered the prompt yet.
    AwaitingConfirm {
        name: String,
    },
    Confirmed,
    Declined,
    Refused(PairingRefusal),
}

/// One pairing in progress, from the scan to the athlete's answer.
#[derive(Debug, Clone)]
pub struct Pairing {
    pub invitation: Invitation,
    pub stage: Stage,
}

#[derive(Deserialize)]
struct Prove {
    proof: String,
    #[serde(default)]
    name: String,
}

fn browser_name(name: &str) -> String {
    let name: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    if name.is_empty() {
        "Browser".into()
    } else {
        name
    }
}

impl Pairing {
    pub fn new(invitation: Invitation) -> Self {
        Self {
            invitation,
            stage: Stage::Invited,
        }
    }

    /// Whether a connection presenting `presented` may reach the pairing
    /// methods. Only the browser the QR code named, and only while the
    /// pairing is open.
    pub fn admits(&self, presented: &str, now: i64) -> bool {
        let open = match self.stage {
            Stage::Invited => now <= self.invitation.expires_at,
            Stage::AwaitingConfirm { .. } | Stage::Confirmed => true,
            Stage::Declined | Stage::Refused(_) => false,
        };
        open && spelled(presented).as_deref() == Some(self.invitation.browser.as_str())
    }

    /// Answer one pairing method: `pair.prove` with the browser's proof and
    /// name, which answers the phone's own proof, or `pair.status`.
    pub fn answer(
        &mut self,
        presented: &str,
        phone: &str,
        method: &str,
        params: serde_json::Value,
        now: i64,
        spent: &mut HashSet<[u8; SECRET_BYTES]>,
    ) -> Result<serde_json::Value, String> {
        match method {
            "pair.prove" => {
                if self.stage != Stage::Invited {
                    return Err("already proved".into());
                }
                let ask: Prove = serde_json::from_value(params).map_err(|_| "bad params")?;
                let given = URL_SAFE_NO_PAD
                    .decode(ask.proof.as_bytes())
                    .map_err(|_| "bad params")?;
                match verify(&self.invitation, presented, phone, &given, now, spent) {
                    Ok(()) => {
                        self.stage = Stage::AwaitingConfirm {
                            name: browser_name(&ask.name),
                        };
                        let mine = proof(
                            &self.invitation.secret,
                            Role::Phone,
                            &self.invitation.browser,
                            phone,
                        );
                        Ok(serde_json::json!({ "phoneProof": URL_SAFE_NO_PAD.encode(mine) }))
                    }
                    Err(refusal) => {
                        self.stage = Stage::Refused(refusal);
                        Err(format!("refused: {refusal:?}"))
                    }
                }
            }
            "pair.status" => Ok(serde_json::json!(match self.stage {
                Stage::Invited | Stage::AwaitingConfirm { .. } => "waiting",
                Stage::Confirmed => "confirmed",
                Stage::Declined => "declined",
                Stage::Refused(_) => "refused",
            })),
            other => Err(format!("unknown method: {other}")),
        }
    }

    /// The name the browser gave, while the athlete is being asked.
    pub fn asking(&self) -> Option<&str> {
        match &self.stage {
            Stage::AwaitingConfirm { name } => Some(name),
            _ => None,
        }
    }

    /// The athlete's answer to the prompt. Returns the name and fingerprint
    /// to link when they accepted a proved browser.
    pub fn confirm(&mut self, accept: bool) -> Option<(String, String)> {
        let Stage::AwaitingConfirm { name } = &self.stage else {
            return None;
        };
        let name = name.clone();
        if accept {
            self.stage = Stage::Confirmed;
            Some((name, self.invitation.browser.clone()))
        } else {
            self.stage = Stage::Declined;
            None
        }
    }
}

#[cfg(test)]
#[path = "tests/pairing.rs"]
mod tests;
