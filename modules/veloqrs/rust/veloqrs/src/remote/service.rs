//! The engine's side of the remote link: its certificate, which peers it
//! admits, and the connections it is serving.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::sync::{Arc, Mutex, MutexGuard};

use str0m::config::DtlsCert;

use super::pairing::{self, Invitation, Pairing, PairingRefusal};
use super::peer::{self, Gate, Peer, Refusal};
use crate::persistence::{linked_devices, read_pool, settings_conn};

/// The connections being served, each under the fingerprint it presented.
static PEERS: Mutex<Vec<(Option<String>, Peer)>> = Mutex::new(Vec::new());

/// The fingerprints whose connection is up.
static CONNECTED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The one pairing in progress, from a scan until the next scan or a cancel.
static PAIRING: Mutex<Option<Pairing>> = Mutex::new(None);

/// Every pairing secret used in this process, so none is used twice.
static SPENT: Mutex<Option<HashSet<[u8; 32]>>> = Mutex::new(None);

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs() as i64)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The stored certificate as the bytes `remote_identity` keeps: the
/// certificate's length, the certificate, then the private key.
fn encode(cert: &DtlsCert) -> Vec<u8> {
    let mut bytes = (cert.certificate.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(&cert.certificate);
    bytes.extend_from_slice(&cert.private_key);
    bytes
}

fn decode(bytes: &[u8]) -> Option<DtlsCert> {
    let (len, rest) = bytes.split_first_chunk::<4>()?;
    let len = u32::from_le_bytes(*len) as usize;
    (rest.len() > len).then(|| DtlsCert {
        certificate: rest[..len].to_vec(),
        private_key: rest[len..].to_vec(),
    })
}

/// The phone's certificate, made and kept on first use so a browser that
/// pinned it recognises the phone on every later connection.
fn certificate() -> Result<DtlsCert, String> {
    let stored = read_pool::with_read_conn(linked_devices::identity)
        .ok_or("engine not initialised")?
        .map_err(|error| error.to_string())?;
    if let Some(cert) = stored.as_deref().and_then(decode) {
        return Ok(cert);
    }
    super::install_crypto();
    let made = str0m::crypto::from_feature_flags()
        .dtls_provider
        .generate_certificate()
        .ok_or("could not make a certificate")?;
    settings_conn::with_settings_conn(|conn| {
        linked_devices::store_identity_if_absent(conn, &encode(&made))
    })
    .ok_or("engine not initialised")?
    .map_err(|error| error.to_string())?;
    let kept = read_pool::with_read_conn(linked_devices::identity)
        .ok_or("engine not initialised")?
        .map_err(|error| error.to_string())?;
    kept.as_deref()
        .and_then(decode)
        .ok_or_else(|| "the kept certificate does not read back".into())
}

/// The address a browser on the same network reaches this phone at: the one
/// the system would send from towards the wider network. Nothing is sent.
fn local_address() -> Result<IpAddr, String> {
    let probe = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|error| error.to_string())?;
    probe
        .connect((Ipv4Addr::new(192, 0, 2, 1), 9))
        .map_err(|error| error.to_string())?;
    let address = probe.local_addr().map_err(|error| error.to_string())?.ip();
    if address.is_unspecified() {
        return Err("no network address".into());
    }
    Ok(address)
}

struct EngineGate;

impl Gate for EngineGate {
    fn is_pinned(&self, fingerprint: &str) -> bool {
        linked(fingerprint)
            || lock(&PAIRING)
                .as_ref()
                .is_some_and(|pairing| pairing.admits(fingerprint, now()))
    }

    fn answer(&self, presented: &str, local: &str, request: &str) -> String {
        let parsed: serde_json::Value = serde_json::from_str(request).unwrap_or_default();
        let method = parsed["method"].as_str().unwrap_or_default();
        if method.starts_with("pair.") {
            return pairing_answer(presented, local, &parsed);
        }
        if !linked(presented) {
            return serde_json::json!({ "id": parsed["id"], "error": "not linked" }).to_string();
        }
        read_pool::with_read_conn(|conn| super::protocol::answer(conn, request)).unwrap_or_else(
            || serde_json::json!({ "id": null, "error": "engine not initialised" }).to_string(),
        )
    }

    fn connected(&self, fingerprint: &str) {
        let now = now();
        let _ =
            settings_conn::with_settings_conn(|conn| linked_devices::touch(conn, fingerprint, now));
        lock(&CONNECTED).push(fingerprint.to_owned());
    }

    fn disconnected(&self, fingerprint: &str) {
        let mut connected = lock(&CONNECTED);
        if let Some(at) = connected.iter().position(|f| f == fingerprint) {
            connected.remove(at);
        }
    }
}

fn linked(fingerprint: &str) -> bool {
    read_pool::with_read_conn(|conn| linked_devices::is_pinned(conn, fingerprint))
        .and_then(Result::ok)
        .unwrap_or(false)
}

fn pairing_answer(presented: &str, local: &str, request: &serde_json::Value) -> String {
    let id = request["id"].clone();
    let mut pairing = lock(&PAIRING);
    let Some(pairing) = pairing.as_mut().filter(|p| p.admits(presented, now())) else {
        return serde_json::json!({ "id": id, "error": "no pairing open" }).to_string();
    };
    let mut spent = lock(&SPENT);
    let spent = spent.get_or_insert_with(HashSet::new);
    let method = request["method"].as_str().unwrap_or_default();
    match pairing.answer(
        presented,
        local,
        method,
        request["params"].clone(),
        now(),
        spent,
    ) {
        Ok(result) => serde_json::json!({ "id": id, "result": result }),
        Err(error) => serde_json::json!({ "id": id, "error": error }),
    }
    .to_string()
}

/// Open a pairing from a scanned QR code, replacing any open one. Returns the
/// room the browser waits in.
pub fn begin_pairing(qr: &str) -> Result<String, PairingRefusal> {
    let invitation = Invitation::parse(qr, now())?;
    if lock(&SPENT)
        .as_ref()
        .is_some_and(|spent| spent.contains(&invitation.secret))
    {
        return Err(PairingRefusal::Spent);
    }
    let room = invitation.room.clone();
    *lock(&PAIRING) = Some(Pairing::new(invitation));
    Ok(room)
}

/// The name of a proved browser waiting for the athlete's answer.
pub fn pairing_request() -> Option<String> {
    lock(&PAIRING)
        .as_ref()
        .and_then(|pairing| pairing.asking().map(str::to_owned))
}

/// The athlete's answer to the prompt. Accepting links the browser; declining
/// ends its connection. Returns whether a browser was linked.
pub fn confirm_pairing(accept: bool) -> Result<bool, String> {
    let (decision, browser) = {
        let mut pairing = lock(&PAIRING);
        let Some(pairing) = pairing.as_mut() else {
            return Ok(false);
        };
        let browser = pairing.invitation.browser.clone();
        (pairing.confirm(accept), browser)
    };
    match decision {
        Some((name, fingerprint)) => {
            let now = now();
            settings_conn::with_settings_conn(|conn| {
                linked_devices::add(conn, &name, &fingerprint, now)
            })
            .ok_or("engine not initialised")?
            .map_err(|error| error.to_string())?;
            Ok(true)
        }
        None => {
            if !accept {
                disconnect(Some(&browser));
            }
            Ok(false)
        }
    }
}

/// Close the open pairing and end the connection it admitted, if not linked.
pub fn cancel_pairing() {
    let open = lock(&PAIRING).take();
    if let Some(pairing) = open
        && !linked(&pairing.invitation.browser)
    {
        disconnect(Some(&pairing.invitation.browser));
    }
}

/// Answer a linked browser's offer and serve it. Returns the answer.
pub fn accept_offer(offer: &str) -> Result<String, Refusal> {
    let fingerprint = serde_json::from_str::<serde_json::Value>(offer)
        .ok()
        .and_then(|value| value.get("sdp")?.as_str().map(peer::offered_fingerprint))
        .flatten();
    let cert = certificate().map_err(Refusal::Engine)?;
    let address = local_address().map_err(Refusal::Network)?;
    let (answer, served) = peer::accept(offer, cert, address, Arc::new(EngineGate))?;
    let mut peers = lock(&PEERS);
    peers.retain(|(_, peer)| !peer.is_finished());
    peers.push((fingerprint, served));
    Ok(answer)
}

/// The rooms the phone waits in while open, one for each linked browser.
pub fn linked_rooms() -> Result<Vec<String>, String> {
    let browsers = read_pool::with_read_conn(linked_devices::fingerprints)
        .ok_or("engine not initialised")?
        .map_err(|error| error.to_string())?;
    if browsers.is_empty() {
        return Ok(Vec::new());
    }
    let phone = pairing::fingerprint_of(&certificate()?.certificate);
    Ok(browsers
        .iter()
        .map(|browser| pairing::room_for(browser, &phone))
        .collect())
}

/// End every connection, or only those of one fingerprint.
pub fn disconnect(fingerprint: Option<&str>) {
    let ending: Vec<Peer> = {
        let mut peers = lock(&PEERS);
        let (ending, keeping) =
            std::mem::take(&mut *peers)
                .into_iter()
                .partition(|(presented, _)| {
                    fingerprint.is_none() || presented.as_deref() == fingerprint
                });
        *peers = keeping;
        ending.into_iter().map(|(_, peer)| peer).collect()
    };
    for peer in ending {
        peer.stop();
    }
}

/// How many linked browsers are connected now.
pub fn connected_count() -> u32 {
    lock(&CONNECTED).len() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_kept_certificate_reads_back_whole() {
        let cert = DtlsCert {
            certificate: vec![1, 2, 3],
            private_key: vec![9, 8],
        };
        let back = decode(&encode(&cert)).expect("decodes");
        assert_eq!(back.certificate, cert.certificate);
        assert_eq!(back.private_key, cert.private_key);
    }

    #[test]
    fn the_phone_fingerprint_is_the_one_its_connections_present() {
        crate::remote::install_crypto();
        let cert = str0m::crypto::from_feature_flags()
            .dtls_provider
            .generate_certificate()
            .expect("a certificate");
        let ours = pairing::fingerprint_of(&cert.certificate);
        let mut rtc = str0m::RtcConfig::new()
            .set_dtls_cert(cert)
            .build(std::time::Instant::now());
        let shown = rtc.direct_api().local_dtls_fingerprint().to_string();
        let (hash, hex) = shown.split_once(' ').expect("hash and hex");
        assert_eq!(
            ours,
            format!("{} {}", hash.to_ascii_lowercase(), hex.to_ascii_uppercase())
        );
    }

    #[test]
    fn a_truncated_certificate_is_not_read() {
        assert!(decode(&[5, 0, 0, 0, 1, 2]).is_none());
        assert!(decode(&[1, 0]).is_none());
    }
}
