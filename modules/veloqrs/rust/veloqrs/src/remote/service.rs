//! The engine's side of the remote link: its certificate, which peers it
//! admits, and the connections it is serving.

use crate::poison::Recover;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use str0m::config::DtlsCert;

use super::DisconnectReason;
use super::pairing::{self, Invitation, Pairing, PairingRefusal, SpentSecrets};
use super::peer::{self, Gate, Peer, Refusal};
use crate::persistence::{linked_devices, read_pool, settings_conn};

/// The connections being served, each under the fingerprint it presented.
static PEERS: Mutex<Vec<(Option<String>, Peer)>> = Mutex::new(Vec::new());

/// The connections that are up, each with the Unix seconds it came up, in the
/// order they came up.
static CONNECTED: Mutex<Vec<(String, i64)>> = Mutex::new(Vec::new());

/// The history row of each connection that is up, under the fingerprint it
/// presented, in the order they came up.
static OPEN_ROWS: Mutex<Vec<(String, i64)>> = Mutex::new(Vec::new());

/// Set once this process has ended the rows a past process left open.
static STALE_CLOSED: AtomicBool = AtomicBool::new(false);

/// Whether the app is in front. A linked browser's write is answered only
/// while it is; reads are answered either way. True until the app says
/// otherwise, so a build with no app around it behaves as before.
static IN_FRONT: AtomicBool = AtomicBool::new(true);

/// The one pairing in progress, from a scan until the next scan or a cancel.
static PAIRING: Mutex<Option<Pairing>> = Mutex::new(None);

pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs() as i64)
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

/// The reply to a write made while the app is not in front. The page matches
/// on this text to tell the athlete to unlock the phone.
pub const PHONE_LOCKED: &str = "phone locked";

/// Tell the engine whether the app is in front.
pub fn set_in_front(in_front: bool) {
    IN_FRONT.store(in_front, Ordering::Release);
}

struct EngineGate;

impl Gate for EngineGate {
    fn is_pinned(&self, fingerprint: &str) -> bool {
        linked(fingerprint)
            || PAIRING
                .lock_recover()
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
        if super::protocol::is_write(method) {
            if !IN_FRONT.load(Ordering::Acquire) {
                return serde_json::json!({ "id": parsed["id"], "error": PHONE_LOCKED })
                    .to_string();
            }
            if super::protocol::is_spool(method) {
                return super::protocol::answer_spool(presented, request);
            }
            return match crate::objects::error::with_engine(|engine| {
                super::protocol::answer_write(engine, presented, request)
            }) {
                Ok(answered) => answered.announce(),
                Err(error) => serde_json::json!({ "id": parsed["id"], "error": error.to_string() })
                    .to_string(),
            };
        }
        if method == "link.hello" {
            keep_client(presented, &parsed);
        }
        let athlete = crate::objects::sync::signed_in_athlete_id();
        let connections = connections();
        let caller = super::protocol::Caller {
            browser: presented,
            athlete: athlete.as_deref(),
            connections: &connections,
        };
        read_pool::with_read_conn(|conn| super::protocol::answer_from(conn, &caller, request))
            .unwrap_or_else(|| {
                serde_json::json!({ "id": null, "error": "engine not initialised" }).to_string()
            })
    }

    fn answer_bytes(&self, presented: &str, local: &str, request: &str) -> super::protocol::Answer {
        let parsed: serde_json::Value = serde_json::from_str(request).unwrap_or_default();
        let method = parsed["method"].as_str().unwrap_or_default();
        if linked(presented)
            && IN_FRONT.load(Ordering::Acquire)
            && super::protocol::is_spool_bytes(method)
        {
            return super::protocol::answer_spool_bytes(presented, request);
        }
        super::protocol::Answer::Text(self.answer(presented, local, request))
    }

    fn connected(&self, fingerprint: &str, from: Option<SocketAddr>, local: SocketAddr) {
        let now = now();
        let _ = settings_conn::with_settings_conn(|conn| {
            linked_devices::touch(conn, fingerprint, now)?;
            if !STALE_CLOSED.swap(true, Ordering::AcqRel) {
                linked_devices::close_open_connections(conn, now)?;
            }
            if let Some(from) = from
                && let Some(row) = linked_devices::open_connection(
                    conn,
                    fingerprint,
                    from.ip(),
                    (!local.ip().is_unspecified()).then_some(local.ip()),
                    now,
                )?
            {
                OPEN_ROWS.lock_recover().push((fingerprint.to_owned(), row));
            }
            Ok::<(), rusqlite::Error>(())
        });
        CONNECTED.lock_recover().push((fingerprint.to_owned(), now));
    }

    fn changed(&self) -> Option<u64> {
        database_stamp()
    }

    fn frame(&self, presented: &str, bytes: &[u8]) {
        // A browser unlinked while its import is open writes nothing more.
        if linked(presented) {
            super::import::frame(presented, bytes);
        }
    }

    fn disconnected(&self, fingerprint: &str, reason: Option<DisconnectReason>) {
        let mut connected = CONNECTED.lock_recover();
        if let Some(at) = connected.iter().position(|(f, _)| f == fingerprint) {
            connected.remove(at);
        }
        drop(connected);
        let row = {
            let mut open = OPEN_ROWS.lock_recover();
            open.iter()
                .position(|(f, _)| f == fingerprint)
                .map(|at| open.remove(at).1)
        };
        if let Some(row) = row {
            let now = now();
            let _ = settings_conn::with_settings_conn(|conn| {
                linked_devices::close_connection(conn, row, end_reason(reason), now)
            });
        }
    }
}

/// The word the history keeps for why a connection ended. A connection the
/// phone did not end is `closed`.
pub(super) fn end_reason(reason: Option<DisconnectReason>) -> &'static str {
    match reason {
        None => "closed",
        Some(DisconnectReason::Background) => "backgrounded",
        Some(DisconnectReason::SwitchedOff) => "switched_off",
        Some(DisconnectReason::Removed) => "removed",
        Some(DisconnectReason::Disconnected) => "disconnected",
        Some(DisconnectReason::Declined) => "refused",
    }
}

/// Keep what the client at `fingerprint` said it is in its hello on its
/// open connection's row. A hello with no description keeps nothing.
fn keep_client(fingerprint: &str, request: &serde_json::Value) {
    let Ok(client) = serde_json::from_value::<super::protocol::FfiLinkClient>(
        request["params"]["client"].clone(),
    ) else {
        return;
    };
    let Some(client) = super::client::describe(&client) else {
        return;
    };
    let Some(row) = OPEN_ROWS
        .lock_recover()
        .iter()
        .rev()
        .find(|(f, _)| f == fingerprint)
        .map(|(_, row)| *row)
    else {
        return;
    };
    let _ =
        settings_conn::with_settings_conn(|conn| linked_devices::set_client(conn, row, &client));
}

/// The connection the library's stamp is read on: one of this module's own,
/// with the path it was opened for.
static STAMP: Mutex<Option<(String, rusqlite::Connection)>> = Mutex::new(None);

/// `PRAGMA data_version` on a read connection of the remote link's own. It
/// differs from the last reading whenever another connection committed, so a
/// write by the engine moves it. Nothing when no engine is installed or the
/// value cannot be read.
fn database_stamp() -> Option<u64> {
    let (_, path) = read_pool::binding()?;
    let mut held = STAMP.lock_recover();
    if held.as_ref().is_none_or(|(opened, _)| *opened != path) {
        *held = Some((path.clone(), read_pool::open_reader(&path).ok()?));
    }
    let (_, conn) = held.as_ref()?;
    let stamp: Result<i64, _> = conn.query_row("PRAGMA data_version", [], |row| row.get(0));
    match stamp {
        Ok(value) => Some(value as u64),
        Err(_) => {
            *held = None;
            None
        }
    }
}

fn linked(fingerprint: &str) -> bool {
    read_pool::with_read_conn(|conn| linked_devices::is_pinned(conn, fingerprint))
        .and_then(Result::ok)
        .unwrap_or(false)
}

/// The key a spent pairing secret is recorded under: its SHA-256, so the
/// library never holds a secret itself.
fn spent_key(secret: &[u8; 32]) -> [u8; 32] {
    super::digest::sha256(&[&secret[..]])
}

/// The library's record of spent pairing secrets, written through the
/// settings connection. A secret whose record cannot be written is refused.
struct LibrarySpent<'a>(&'a rusqlite::Connection);

impl SpentSecrets for LibrarySpent<'_> {
    fn spend(&mut self, secret: &[u8; 32], expires_at: i64, now: i64) -> bool {
        linked_devices::spend_secret(self.0, &spent_key(secret), expires_at, now).unwrap_or(false)
    }
}

/// Stands in for the record on a method that spends no secret. A secret
/// offered to it is refused.
struct NothingSpent;

impl SpentSecrets for NothingSpent {
    fn spend(&mut self, _: &[u8; 32], _: i64, _: i64) -> bool {
        false
    }
}

fn pairing_answer(presented: &str, local: &str, request: &serde_json::Value) -> String {
    let id = request["id"].clone();
    let mut pairing = PAIRING.lock_recover();
    let Some(pairing) = pairing.as_mut().filter(|p| p.admits(presented, now())) else {
        // The pairing closes when the athlete accepts, so a browser polling
        // after that is answered from its link.
        if request["method"].as_str() == Some("pair.status") && linked(presented) {
            return serde_json::json!({ "id": id, "result": "confirmed" }).to_string();
        }
        return serde_json::json!({ "id": id, "error": "no pairing open" }).to_string();
    };
    let method = request["method"].as_str().unwrap_or_default();
    let params = request["params"].clone();
    let answered = if method == "pair.prove" {
        settings_conn::with_settings_conn(|conn| {
            pairing.answer(
                presented,
                local,
                method,
                params,
                now(),
                &mut LibrarySpent(conn),
            )
        })
        .unwrap_or_else(|| Err("engine not initialised".into()))
    } else {
        pairing.answer(presented, local, method, params, now(), &mut NothingSpent)
    };
    match answered {
        Ok(result) => serde_json::json!({ "id": id, "result": result }),
        Err(error) => serde_json::json!({ "id": id, "error": error }),
    }
    .to_string()
}

/// Open a pairing from a scanned QR code, replacing any open one. Returns the
/// room the browser waits in.
pub fn begin_pairing(qr: &str) -> Result<String, PairingRefusal> {
    let invitation = Invitation::parse(qr, now())?;
    // An unreadable record refuses the secret: whether it was spent is unknown.
    let spent = read_pool::with_read_conn(|conn| {
        linked_devices::secret_spent(conn, &spent_key(&invitation.secret))
    })
    .and_then(Result::ok)
    .unwrap_or(true);
    if spent {
        return Err(PairingRefusal::Spent);
    }
    let room = invitation.room.clone();
    *PAIRING.lock_recover() = Some(Pairing::new(invitation));
    Ok(room)
}

/// The name of a proved browser waiting for the athlete's answer.
pub fn pairing_request() -> Option<String> {
    PAIRING
        .lock_recover()
        .as_ref()
        .and_then(|pairing| pairing.asking().map(str::to_owned))
}

/// The athlete's answer to the prompt. Accepting links the browser; declining
/// ends its connection. Returns whether a browser was linked.
pub fn confirm_pairing(accept: bool) -> Result<bool, String> {
    let (decision, browser, secret) = {
        let mut pairing = PAIRING.lock_recover();
        let Some(pairing) = pairing.as_mut() else {
            return Ok(false);
        };
        let browser = pairing.invitation.browser.clone();
        let secret = pairing.invitation.secret;
        (pairing.confirm(accept), browser, secret)
    };
    match decision {
        Some((name, fingerprint)) => {
            let now = now();
            let stored = settings_conn::with_settings_conn(|conn| {
                linked_devices::add(conn, &name, &fingerprint, Some(&secret), now)
            })
            .ok_or_else(|| "engine not initialised".to_owned())
            .and_then(|added| added.map(drop).map_err(|error| error.to_string()));
            close_pairing_for(&fingerprint);
            stored?;
            Ok(true)
        }
        None => {
            if !accept {
                disconnect(Some(&browser), DisconnectReason::Declined);
            }
            Ok(false)
        }
    }
}

/// Unlink the device with row `id` and end its connection, if it has one.
/// Written on the connection no engine lock stands in front of. Returns
/// whether a device was removed.
pub fn unlink(id: &str) -> Result<bool, crate::objects::error::VeloqError> {
    use crate::objects::error::{VeloqError, engine_refused};
    let (fingerprint, removed) = settings_conn::with_settings_conn(|conn| {
        let fingerprint = linked_devices::fingerprint_of(conn, id)?;
        linked_devices::remove(conn, id).map(|removed| (fingerprint, removed))
    })
    .ok_or_else(engine_refused)?
    .map_err(|error| VeloqError::database(error.to_string()))?;
    if let Some(fingerprint) = fingerprint {
        forget(&fingerprint);
        disconnect(Some(&fingerprint), DisconnectReason::Removed);
    }
    Ok(removed)
}

/// End the connection of the device with row `id`, keeping its link. Returns
/// whether the device exists.
pub fn disconnect_device(id: &str) -> Result<bool, crate::objects::error::VeloqError> {
    use crate::objects::error::{VeloqError, engine_refused};
    let fingerprint =
        settings_conn::with_settings_conn(|conn| linked_devices::fingerprint_of(conn, id))
            .ok_or_else(engine_refused)?
            .map_err(|error| VeloqError::database(error.to_string()))?;
    let Some(fingerprint) = fingerprint else {
        return Ok(false);
    };
    disconnect(Some(&fingerprint), DisconnectReason::Disconnected);
    Ok(true)
}

/// Give the device with row `id` a new name. Returns whether it exists.
pub fn rename_device(id: &str, name: &str) -> Result<bool, crate::objects::error::VeloqError> {
    use crate::objects::error::{VeloqError, engine_refused};
    settings_conn::with_settings_conn(|conn| linked_devices::rename(conn, id, name))
        .ok_or_else(engine_refused)?
        .map_err(|error| VeloqError::database(error.to_string()))
}

/// Close the open pairing when it is for `browser`, whatever its stage.
fn close_pairing_for(browser: &str) {
    let mut open = PAIRING.lock_recover();
    if open
        .as_ref()
        .is_some_and(|pairing| pairing.invitation.browser == browser)
    {
        *open = None;
    }
}

/// Drop what a browser holds on the phone beside its link row: a pairing open
/// for it and the imports it has in progress.
pub fn forget(browser: &str) {
    close_pairing_for(browser);
    super::import::forget_browser(browser);
    super::export::forget_device(browser);
}

/// Close the open pairing and end the connection it admitted, if not linked.
pub fn cancel_pairing() {
    let open = PAIRING.lock_recover().take();
    if let Some(pairing) = open
        && !linked(&pairing.invitation.browser)
    {
        disconnect(
            Some(&pairing.invitation.browser),
            DisconnectReason::Declined,
        );
    }
}

/// Answer a linked browser's offer and serve it. Returns the answer.
pub fn accept_offer(offer: &str) -> Result<String, Refusal> {
    accept_offer_with(offer, Arc::new(EngineGate), || {
        super::import::sweep_stale();
        super::export::sweep_stale();
        let cert = certificate().map_err(Refusal::Engine)?;
        let address = local_address().map_err(Refusal::Network)?;
        let stun = super::stun::Stun::resolve_default(address.is_ipv6());
        Ok((cert, address, stun))
    })
    .inspect_err(|refusal| {
        if matches!(refusal, Refusal::NotPinned) {
            let now = now();
            let _ =
                settings_conn::with_settings_conn(|conn| linked_devices::count_refusal(conn, now));
        }
    })
}

/// Serve an offer from a pinned browser. `prepare` does the disk and network
/// work an answer needs, and runs only once the offer's browser is pinned.
pub(crate) fn accept_offer_with<G: Gate>(
    offer: &str,
    gate: Arc<G>,
    prepare: impl FnOnce() -> Result<(DtlsCert, IpAddr, Option<super::stun::Stun>), Refusal>,
) -> Result<String, Refusal> {
    peer::check_pinned(offer, gate.as_ref())?;
    let fingerprint = serde_json::from_str::<serde_json::Value>(offer)
        .ok()
        .and_then(|value| value.get("sdp")?.as_str().map(peer::offered_fingerprint))
        .flatten();
    let (cert, address, stun) = prepare()?;
    let (answer, served) = peer::accept(offer, cert, address, gate, stun)?;
    let replaced: Vec<Peer> = {
        let mut peers = PEERS.lock_recover();
        peers.retain(|(_, peer)| !peer.is_finished());
        let (old, keeping) =
            std::mem::take(&mut *peers)
                .into_iter()
                .partition(|(presented, peer)| {
                    fingerprint.is_some() && *presented == fingerprint && peer.is_pending()
                });
        *peers = keeping;
        peers.push((fingerprint, served));
        old.into_iter().map(|(_, peer)| peer).collect()
    };
    for peer in replaced {
        peer.stop(DisconnectReason::Disconnected);
    }
    Ok(answer)
}

/// The rooms the phone waits in while open, one for each linked browser.
pub fn linked_rooms() -> Result<Vec<String>, String> {
    let browsers = read_pool::with_read_conn(linked_devices::room_keys)
        .ok_or("engine not initialised")?
        .map_err(|error| error.to_string())?;
    if browsers.is_empty() {
        return Ok(Vec::new());
    }
    Ok(rooms_for(&browsers, &certificate()?.certificate))
}

/// The room of each pinned browser that holds a pairing secret, for the phone
/// whose certificate is `certificate`. The one place the phone's side of a room is derived, from the
/// same certificate every answer presents. A browser with no secret has no room,
/// so it must pair again.
fn rooms_for(browsers: &[(String, Option<Vec<u8>>)], certificate: &[u8]) -> Vec<String> {
    let phone = pairing::fingerprint_of(certificate);
    browsers
        .iter()
        .filter_map(|(browser, secret)| {
            let secret = secret.as_ref()?;
            Some(pairing::room_for(secret, browser, &phone))
        })
        .collect()
}

/// End every connection, or only those of one fingerprint, telling each
/// browser why first.
pub fn disconnect(fingerprint: Option<&str>, reason: DisconnectReason) {
    let ending: Vec<Peer> = {
        let mut peers = PEERS.lock_recover();
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
        peer.stop(reason);
    }
}

/// How many linked browsers are connected now.
pub fn connected_count() -> u32 {
    CONNECTED.lock_recover().len() as u32
}

/// Every connection that is up, with the Unix seconds it came up.
pub fn connections() -> Vec<(String, i64)> {
    CONNECTED.lock_recover().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn every_way_a_connection_ends_has_a_word_and_an_unforced_end_is_closed() {
        assert_eq!(end_reason(None), "closed");
        assert_eq!(
            end_reason(Some(DisconnectReason::Background)),
            "backgrounded"
        );
        assert_eq!(end_reason(Some(DisconnectReason::Removed)), "removed");
        assert_eq!(end_reason(Some(DisconnectReason::Declined)), "refused");
    }

    #[test]
    fn ending_one_fingerprint_leaves_another_connection_up() {
        let _serial = crate::test_globals::serial_global_state();
        let (a, b) = ("sha-256 AA:AA", "sha-256 BB:BB");
        {
            let mut peers = PEERS.lock_recover();
            peers.clear();
            peers.push((Some(a.to_owned()), Peer::idle()));
            peers.push((Some(b.to_owned()), Peer::idle()));
        }

        disconnect(Some("sha-256 CC:CC"), DisconnectReason::Disconnected);
        assert_eq!(
            PEERS.lock_recover().len(),
            2,
            "an unknown fingerprint ends nothing"
        );

        disconnect(Some(a), DisconnectReason::Disconnected);
        let mut peers = PEERS.lock_recover();
        let left: Vec<_> = peers.iter().map(|(f, _)| f.clone()).collect();
        assert_eq!(left, vec![Some(b.to_owned())]);
        assert!(!peers[0].1.is_finished(), "the other peer is still up");
        for (_, peer) in std::mem::take(&mut *peers) {
            peer.stop(DisconnectReason::Disconnected);
        }
    }

    #[test]
    fn disconnecting_a_device_by_id_ends_only_its_connection_and_keeps_its_link() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("disconnect.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        let (a, b) = ("sha-256 AA:AA", "sha-256 BB:BB");
        let id = crate::objects::error::with_engine(|engine| {
            let id = linked_devices::add(&engine.db, "Laptop", a, None, 1).unwrap();
            linked_devices::add(&engine.db, "Tablet", b, None, 1).unwrap();
            id
        })
        .unwrap();
        {
            let mut peers = PEERS.lock_recover();
            peers.clear();
            peers.push((Some(a.to_owned()), Peer::idle()));
            peers.push((Some(b.to_owned()), Peer::idle()));
        }

        assert!(disconnect_device(&id).unwrap());
        assert!(!disconnect_device("999").unwrap());
        assert!(!disconnect_device("not a number").unwrap());

        let mut peers = PEERS.lock_recover();
        let left: Vec<_> = peers.iter().map(|(f, _)| f.clone()).collect();
        assert_eq!(left, vec![Some(b.to_owned())]);
        assert!(!peers[0].1.is_finished());
        for (_, peer) in std::mem::take(&mut *peers) {
            peer.stop(DisconnectReason::Disconnected);
        }
        drop(peers);
        let still_linked = crate::objects::error::with_engine(|engine| {
            linked_devices::is_pinned(&engine.db, a).unwrap()
        })
        .unwrap();
        assert!(still_linked);
    }

    #[test]
    fn renaming_a_device_by_id_changes_its_name_and_only_its_name() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("rename.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        let (id, other) = crate::objects::error::with_engine(|engine| {
            (
                linked_devices::add(&engine.db, "Laptop", "sha-256 AA:AA", None, 1).unwrap(),
                linked_devices::add(&engine.db, "Tablet", "sha-256 BB:BB", None, 1).unwrap(),
            )
        })
        .unwrap();

        assert!(rename_device(&id, "  Desk  ").unwrap());
        assert!(!rename_device("999", "Ghost").unwrap());
        assert!(
            !rename_device(&other, "   ").unwrap(),
            "a blank name is refused"
        );

        let names = crate::objects::error::with_engine(|engine| {
            linked_devices::list(&engine.db, &[])
                .unwrap()
                .into_iter()
                .map(|d| (d.id, d.name))
                .collect::<Vec<_>>()
        })
        .unwrap();
        assert!(names.contains(&(id, "Desk".to_owned())));
        assert!(names.contains(&(other, "Tablet".to_owned())));
    }

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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_linked_room_is_the_one_the_page_derives_from_the_answer() {
        crate::remote::install_crypto();
        let cert = str0m::crypto::from_feature_flags()
            .dtls_provider
            .generate_certificate()
            .expect("a certificate");
        let kept = decode(&encode(&cert)).expect("decodes");
        let browser = "sha-256 AA:BB:CC";

        let mut rtc = str0m::RtcConfig::new()
            .set_dtls_cert(kept.clone())
            .build(std::time::Instant::now());
        let shown = rtc.direct_api().local_dtls_fingerprint().to_string();
        let answered = peer::offered_fingerprint(&format!("a=fingerprint:{shown}\r\n"))
            .expect("the answer names a fingerprint");

        assert_eq!(
            rooms_for(&[(browser.into(), Some(vec![5; 32]))], &kept.certificate),
            vec![pairing::room_for(&[5; 32], browser, &answered)]
        );
    }

    #[test]
    fn a_browser_linked_without_a_secret_is_offered_no_room() {
        let cert = [1u8, 2, 3];
        let phone = pairing::fingerprint_of(&cert);
        let rooms = rooms_for(
            &[
                ("sha-256 AA:BB".into(), None),
                ("sha-256 CC:DD".into(), Some(vec![5; 32])),
            ],
            &cert,
        );
        assert_eq!(
            rooms,
            vec![pairing::room_for(&[5; 32], "sha-256 CC:DD", &phone)]
        );
    }

    #[test]
    fn only_a_linked_browser_renames_a_section_through_the_gate() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("gate.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        crate::objects::error::with_engine(|engine| {
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES ('s_a', 'auto', 'Climb 1', 'Ride', '[[46.2,7.3],[46.21,7.3]]',
                        400.0, 0, 1, '2026-01-01T00:00:00Z', 46.2, 46.21, 7.3, 7.31)",
                    [],
                )
                .unwrap();
            linked_devices::add(&engine.db, "Laptop", "sha-256 AA:BB", None, 1).unwrap();
        })
        .unwrap();
        let rename = r#"{"id":1,"method":"section.rename","params":{"id":"s_a","name":"Col"}}"#;
        let name = || {
            crate::objects::error::with_engine(|engine| {
                crate::persistence::sections::naming::pooled::all_section_names(&engine.db)
                    .remove("s_a")
            })
            .unwrap()
        };

        let refused = EngineGate.answer("sha-256 FF:FF", "local", rename);
        assert!(refused.contains("not linked"), "{refused}");
        assert_eq!(name().as_deref(), Some("Climb 1"));

        let done = EngineGate.answer("sha-256 AA:BB", "local", rename);
        assert!(done.contains(r#""ok":true"#), "{done}");
        assert_eq!(name().as_deref(), Some("Col"));
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_write_waits_for_the_app_to_be_in_front_and_a_read_does_not() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("front.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        crate::objects::error::with_engine(|engine| {
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES ('s_a', 'auto', 'Climb 1', 'Ride', '[[46.2,7.3],[46.21,7.3]]',
                        400.0, 0, 1, '2026-01-01T00:00:00Z', 46.2, 46.21, 7.3, 7.31)",
                    [],
                )
                .unwrap();
            linked_devices::add(&engine.db, "Laptop", "sha-256 AA:BB", None, 1).unwrap();
        })
        .unwrap();
        let rename = r#"{"id":1,"method":"section.rename","params":{"id":"s_a","name":"Col"}}"#;
        let feed = r#"{"id":2,"method":"feed.page","params":{"offset":0,"limit":5,"needle":""}}"#;
        let name = || {
            crate::objects::error::with_engine(|engine| {
                crate::persistence::sections::naming::pooled::all_section_names(&engine.db)
                    .remove("s_a")
            })
            .unwrap()
        };

        set_in_front(false);
        let locked = EngineGate.answer("sha-256 AA:BB", "local", rename);
        let read = EngineGate.answer("sha-256 AA:BB", "local", feed);
        set_in_front(true);
        assert!(locked.contains(r#""error":"phone locked""#), "{locked}");
        assert_eq!(name().as_deref(), Some("Climb 1"));
        assert!(!read.contains("phone locked"), "{read}");
        assert!(read.contains("result"), "{read}");

        let done = EngineGate.answer("sha-256 AA:BB", "local", rename);
        assert!(done.contains(r#""ok":true"#), "{done}");
        assert_eq!(name().as_deref(), Some("Col"));
    }

    fn invitation_qr(browser: &str, secret: [u8; 32]) -> String {
        serde_json::json!({
            "v": 1,
            "room": "remote-spent-room-0000000000",
            "secret": pairing::encode_secret(&secret),
            "fp": browser,
            "exp": now() + 100,
        })
        .to_string()
    }

    fn prove_request(browser: &str, phone: &str, secret: [u8; 32]) -> String {
        use base64::Engine as _;
        let proof = pairing::proof(&secret, pairing::Role::Browser, browser, phone);
        serde_json::json!({
            "id": 1,
            "method": "pair.prove",
            "params": {
                "proof": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(proof),
                "name": "Tablet",
            },
        })
        .to_string()
    }

    /// Scenario: a pairing secret is spent, the process restarts inside the
    /// invitation's two minutes, and the same QR code is scanned again.
    /// Expected behaviour: the restarted engine refuses the spent secret, and
    /// a fresh invitation still opens a pairing.
    #[test]
    fn a_secret_spent_before_a_restart_is_refused_after_it() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("restart.db").to_str().unwrap().to_string();
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.clone()
            )
        );

        let browser = "sha-256 AA:BB:CC:21";
        let phone = "sha-256 DD:EE:FF:21";
        let spent = invitation_qr(browser, [4u8; 32]);
        begin_pairing(&spent).expect("the first scan opens a pairing");
        let proved = EngineGate.answer(browser, phone, &prove_request(browser, phone, [4u8; 32]));
        assert!(proved.contains("phoneProof"), "{proved}");
        let held_as_secret: i64 = crate::objects::error::with_engine(|engine| {
            engine
                .db
                .query_row(
                    "SELECT COUNT(*) FROM remote_spent WHERE digest = ?1",
                    [&[4u8; 32][..]],
                    |row| row.get(0),
                )
                .unwrap()
        })
        .unwrap();
        assert_eq!(
            held_as_secret, 0,
            "the library must not hold the secret itself"
        );

        // The process goes: its open pairing is dropped, and the library is
        // opened again from its file.
        *PAIRING.lock_recover() = None;
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path
            )
        );

        assert_eq!(begin_pairing(&spent), Err(PairingRefusal::Spent));
        assert!(begin_pairing(&invitation_qr(browser, [5u8; 32])).is_ok());
    }

    fn zip_of_one_ride() -> Vec<u8> {
        use std::io::Write;
        let mut out = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut out);
        writer
            .start_file("ride.fit", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer
            .write_all(&crate::fit_synthetic::outdoor_ride().to_fit())
            .unwrap();
        writer.finish().unwrap();
        out.into_inner()
    }

    fn inbound_frame(id: u32, seq: u32, payload: &[u8]) -> Vec<u8> {
        let mut frame = vec![1, 0];
        frame.extend_from_slice(&id.to_be_bytes());
        frame.extend_from_slice(&seq.to_be_bytes());
        frame.extend_from_slice(payload);
        frame
    }

    fn result_of(reply: &str) -> serde_json::Value {
        let parsed: serde_json::Value = serde_json::from_str(reply).unwrap();
        assert!(parsed.get("error").is_none(), "{reply}");
        parsed["result"].clone()
    }

    #[test]
    fn a_linked_browser_sends_a_zip_in_frames_and_the_import_job_stores_its_ride() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("import.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        crate::objects::error::with_engine(|engine| {
            linked_devices::add(&engine.db, "Laptop", "sha-256 AA:BB", None, 1).unwrap();
            linked_devices::add(&engine.db, "Tablet", "sha-256 CC:DD", None, 1).unwrap();
        })
        .unwrap();
        let archive = zip_of_one_ride();
        let digest: String = super::super::digest::sha256(&[&archive])
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let ask = |browser: &str, id: u32, method: &str, params: serde_json::Value| {
            let request =
                serde_json::json!({ "id": id, "method": method, "params": params }).to_string();
            EngineGate.answer(browser, "local", &request)
        };
        let begin = serde_json::json!({
            "name": "rides.zip", "size": archive.len(), "sha256": digest,
        });

        let unlinked = ask("sha-256 FF:FF", 1, "import.begin", begin.clone());
        assert!(unlinked.contains("not linked"), "{unlinked}");

        set_in_front(false);
        let locked = ask("sha-256 AA:BB", 1, "import.begin", begin.clone());
        set_in_front(true);
        assert!(locked.contains(PHONE_LOCKED), "{locked}");

        let begun = result_of(&ask("sha-256 AA:BB", 2, "import.begin", begin));
        let id = begun["importId"].as_u64().unwrap() as u32;
        assert_eq!(begun["offset"].as_f64(), Some(0.0));

        let stranger = EngineGate;
        let half = archive.len() / 2;
        stranger.frame(
            "sha-256 CC:DD",
            &inbound_frame(id, 0, &archive[..half.min(16384)]),
        );
        for (seq, piece) in archive.chunks(16 * 1024).enumerate() {
            EngineGate.frame("sha-256 AA:BB", &inbound_frame(id, seq as u32, piece));
        }

        let committed = result_of(&ask(
            "sha-256 AA:BB",
            3,
            "import.commit",
            serde_json::json!({ "importId": id }),
        ));
        assert_eq!(committed["jobId"], id);

        let status = || {
            result_of(&ask(
                "sha-256 AA:BB",
                4,
                "import.status",
                serde_json::json!({}),
            ))
        };
        let mut seen = status();
        for _ in 0..500 {
            if seen["state"] == "done" {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
            seen = status();
        }
        assert_eq!(seen["state"], "done", "{seen}");
        assert_eq!(seen["stored"], 1, "{seen}");
        assert_eq!(seen["failed"], 0, "{seen}");
    }

    fn pairing_qr(browser: &str, secret: u8) -> String {
        format!(
            r#"{{"v":1,"room":"room-0123456789abcdefghij","secret":"{}","fp":"{}","exp":{}}}"#,
            pairing::encode_secret(&[secret; 32]),
            browser,
            now() + 60
        )
    }

    /// Scan, prove and accept a pairing for `browser` under the invitation
    /// secret `secret`, which is then linked as a row of `linked_devices`.
    /// Each test uses its own secret, since a spent one is refused.
    fn link_by_pairing(browser: &str, phone: &str, secret: u8) -> String {
        begin_pairing(&pairing_qr(browser, secret)).expect("a pairing opens");
        let proof = pairing::proof(&[secret; 32], pairing::Role::Browser, browser, phone);
        let proved = EngineGate.answer(
            browser,
            phone,
            &serde_json::json!({
                "id": 1,
                "method": "pair.prove",
                "params": { "proof": pairing::encode_secret(&proof), "name": "Laptop" },
            })
            .to_string(),
        );
        assert!(proved.contains("phoneProof"), "{proved}");
        assert_eq!(pairing_request().as_deref(), Some("Laptop"));
        assert_eq!(confirm_pairing(true), Ok(true));
        let id = crate::objects::error::with_engine(|engine| {
            linked_devices::id_of(&engine.db, browser).unwrap()
        })
        .unwrap();
        id.expect("the accepted browser is stored")
    }

    fn status_of(browser: &str, phone: &str) -> String {
        EngineGate.answer(
            browser,
            phone,
            r#"{"id":5,"method":"pair.status","params":null}"#,
        )
    }

    #[test]
    fn a_browser_that_polls_after_the_athlete_accepts_reads_confirmed() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("confirmed.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        let (browser, phone) = ("sha-256 AA:AA", "sha-256 BB:BB");

        link_by_pairing(browser, phone, 11);

        assert!(status_of(browser, phone).contains(r#""result":"confirmed""#));
        assert!(EngineGate.is_pinned(browser));
        assert!(!EngineGate.is_pinned("sha-256 CC:CC"));
        let proved_again = EngineGate.answer(
            browser,
            phone,
            r#"{"id":6,"method":"pair.prove","params":{"proof":"AAAA","name":""}}"#,
        );
        assert!(proved_again.contains("no pairing open"), "{proved_again}");
    }

    #[test]
    fn a_removed_browser_is_shut_out_and_its_import_is_dropped() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("removed.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        let (browser, phone) = ("sha-256 AA:AA", "sha-256 BB:BB");
        let id = link_by_pairing(browser, phone, 12);
        begin_pairing(&pairing_qr(browser, 14)).expect("a second pairing opens");
        let archive = [1u8; 20];
        let digest: String = super::super::digest::sha256(&[&archive])
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let request = |id: u32, method: &str, params: serde_json::Value| {
            serde_json::json!({ "id": id, "method": method, "params": params }).to_string()
        };
        let begun = result_of(&EngineGate.answer(
            browser,
            phone,
            &request(
                2,
                "import.begin",
                serde_json::json!({ "name": "rides.fit", "size": archive.len(), "sha256": digest }),
            ),
        ));
        let import = begun["importId"].as_u64().unwrap() as u32;
        EngineGate.frame(browser, &inbound_frame(import, 0, &archive[..10]));
        let spool = dir.path().join("imports").join(format!("{digest}.part"));
        assert_eq!(std::fs::metadata(&spool).unwrap().len(), 10);

        assert!(unlink(&id).unwrap());

        assert!(!EngineGate.is_pinned(browser));
        assert!(status_of(browser, phone).contains("no pairing open"));
        assert!(pairing_request().is_none());
        assert!(!spool.exists());
        EngineGate.frame(browser, &inbound_frame(import, 1, &archive[10..]));
        let commit = EngineGate.answer(
            browser,
            phone,
            &request(
                3,
                "import.commit",
                serde_json::json!({ "importId": import }),
            ),
        );
        assert!(commit.contains("not linked"), "{commit}");
        assert!(!spool.exists());
    }

    #[test]
    fn a_frame_from_a_browser_unlinked_under_an_open_import_is_not_written() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("unlinked.db");
        assert!(
            crate::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
                path.to_str().unwrap().to_string()
            )
        );
        let (browser, phone) = ("sha-256 AA:AA", "sha-256 BB:BB");
        let id = link_by_pairing(browser, phone, 13);
        let archive = [2u8; 20];
        let digest: String = super::super::digest::sha256(&[&archive])
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let begun = result_of(
            &EngineGate.answer(
                browser,
                phone,
                &serde_json::json!({
                    "id": 2,
                    "method": "import.begin",
                    "params": { "name": "rides.fit", "size": archive.len(), "sha256": digest },
                })
                .to_string(),
            ),
        );
        let import = begun["importId"].as_u64().unwrap() as u32;
        let spool = dir.path().join("imports").join(format!("{digest}.part"));

        crate::objects::error::with_engine(|engine| {
            linked_devices::remove(&engine.db, &id).unwrap();
        })
        .unwrap();
        EngineGate.frame(browser, &inbound_frame(import, 0, &archive[..10]));

        assert_eq!(std::fs::metadata(&spool).unwrap().len(), 0);
    }

    #[test]
    fn a_truncated_certificate_is_not_read() {
        assert!(decode(&[5, 0, 0, 0, 1, 2]).is_none());
        assert!(decode(&[1, 0]).is_none());
    }
}
