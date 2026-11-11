//! One linked browser's connection: a WebRTC data channel the engine serves.
//!
//! The browser offers, the phone answers. An offer whose certificate is not
//! pinned is refused before any answer is made, and the certificate the
//! handshake presents is checked again once the connection is up, so no
//! request is read and no byte is answered for a peer that is not linked.

use std::io::ErrorKind;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use str0m::change::{SdpAnswer, SdpOffer};
use str0m::config::DtlsCert;
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

/// The longest the loop sleeps before it looks at the stop flag again.
const STOP_POLL: Duration = Duration::from_millis(100);

/// What the connection asks of the engine.
pub trait Gate: Send + Sync + 'static {
    /// Whether a peer presenting this certificate fingerprint may connect.
    fn is_pinned(&self, fingerprint: &str) -> bool;
    /// The answer to one request from a peer that may connect. `presented`
    /// is the certificate the peer's connection presented, `local` the
    /// phone's own.
    fn answer(&self, presented: &str, local: &str, request: &str) -> String;
    /// A pinned peer's connection came up.
    fn connected(&self, fingerprint: &str);
    /// A pinned peer's connection ended.
    fn disconnected(&self, fingerprint: &str);
}

/// Why an offer was not answered.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Malformed(String),
    NotPinned,
    Network(String),
    /// The engine could not read or keep what the connection needs.
    Engine(String),
}

/// A served connection. Dropping it leaves the thread running until the peer
/// leaves; `stop` ends it now.
pub struct Peer {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Peer {
    /// End the connection and wait for its thread.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }

    /// Whether the connection has ended.
    pub fn is_finished(&self) -> bool {
        self.thread
            .as_ref()
            .is_none_or(|thread| thread.is_finished())
    }
}

/// The `sha-256 AB:CD:…` fingerprint an SDP announces, in the one spelling
/// pins are stored under.
pub fn offered_fingerprint(sdp: &str) -> Option<String> {
    sdp.lines().find_map(|line| {
        let value = line.trim().strip_prefix("a=fingerprint:")?;
        let (hash, hex) = value.split_once(' ')?;
        Some(normalise(hash, hex))
    })
}

fn normalise(hash: &str, hex: &str) -> String {
    format!(
        "{} {}",
        hash.trim().to_ascii_lowercase(),
        hex.trim().to_ascii_uppercase()
    )
}

/// Answer a browser's offer and serve the connection on its own thread, on a
/// socket bound to `bind`. Returns the answer as the JSON a browser sets as
/// its remote description.
pub fn accept(
    offer: &str,
    cert: DtlsCert,
    bind: IpAddr,
    gate: Arc<dyn Gate>,
) -> Result<(String, Peer), Refusal> {
    super::install_crypto();
    let offer: SdpOffer =
        serde_json::from_str(offer).map_err(|error| Refusal::Malformed(error.to_string()))?;
    let offered = offered_fingerprint(&offer.to_sdp_string()).ok_or(Refusal::NotPinned)?;
    if !gate.is_pinned(&offered) {
        return Err(Refusal::NotPinned);
    }

    let socket = UdpSocket::bind(SocketAddr::new(bind, 0))
        .map_err(|error| Refusal::Network(error.to_string()))?;
    let local = socket
        .local_addr()
        .map_err(|error| Refusal::Network(error.to_string()))?;
    let mut rtc = RtcConfig::new().set_dtls_cert(cert).build(Instant::now());
    let candidate =
        Candidate::host(local, "udp").map_err(|error| Refusal::Network(error.to_string()))?;
    rtc.add_local_candidate(candidate);
    let answer: SdpAnswer = rtc
        .sdp_api()
        .accept_offer(offer)
        .map_err(|error| Refusal::Malformed(error.to_string()))?;
    let answer =
        serde_json::to_string(&answer).map_err(|error| Refusal::Malformed(error.to_string()))?;

    let shown = rtc.direct_api().local_dtls_fingerprint().to_string();
    let (hash, hex) = shown.split_once(' ').unwrap_or((&shown, ""));
    let local_fingerprint = normalise(hash, hex);

    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let thread = std::thread::Builder::new()
        .name("remote-peer".into())
        .spawn(move || serve(rtc, socket, gate, &local_fingerprint, &flag))
        .map_err(|error| Refusal::Network(error.to_string()))?;
    Ok((
        answer,
        Peer {
            stop,
            thread: Some(thread),
        },
    ))
}

fn serve(
    mut rtc: Rtc,
    socket: UdpSocket,
    gate: Arc<dyn Gate>,
    fingerprint: &str,
    stop: &AtomicBool,
) {
    let mut admitted: Option<String> = None;
    let mut buf = vec![0u8; 2000];
    let Ok(local) = socket.local_addr() else {
        return;
    };
    while rtc.is_alive() && !stop.load(Ordering::Relaxed) {
        let deadline = match rtc.poll_output() {
            Ok(Output::Timeout(at)) => at,
            Ok(Output::Transmit(out)) => {
                let _ = socket.send_to(&out.contents, out.destination);
                continue;
            }
            Ok(Output::Event(event)) => {
                if !on_event(&mut rtc, event, &*gate, fingerprint, &mut admitted) {
                    break;
                }
                continue;
            }
            Err(_) => break,
        };
        let wait = deadline
            .saturating_duration_since(Instant::now())
            .min(STOP_POLL);
        if wait.is_zero() {
            if rtc.handle_input(Input::Timeout(Instant::now())).is_err() {
                break;
            }
            continue;
        }
        if socket.set_read_timeout(Some(wait)).is_err() {
            break;
        }
        buf.resize(2000, 0);
        let input = match socket.recv_from(&mut buf) {
            Ok((n, source)) => {
                buf.truncate(n);
                let Ok(contents) = buf.as_slice().try_into() else {
                    continue;
                };
                Input::Receive(
                    Instant::now(),
                    Receive {
                        proto: Protocol::Udp,
                        source,
                        destination: local,
                        contents,
                    },
                )
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                Input::Timeout(Instant::now())
            }
            Err(_) => break,
        };
        if rtc.handle_input(input).is_err() {
            break;
        }
    }
    rtc.disconnect();
    if let Some(fingerprint) = admitted {
        gate.disconnected(&fingerprint);
    }
}

/// Act on one event. False ends the connection.
fn on_event(
    rtc: &mut Rtc,
    event: Event,
    gate: &dyn Gate,
    local: &str,
    admitted: &mut Option<String>,
) -> bool {
    match event {
        Event::Connected => {
            let presented = rtc
                .direct_api()
                .remote_dtls_fingerprint()
                .map(|fingerprint| {
                    let shown = fingerprint.to_string();
                    let (hash, hex) = shown.split_once(' ').unwrap_or((&shown, ""));
                    normalise(hash, hex)
                });
            match presented {
                Some(fingerprint) if gate.is_pinned(&fingerprint) => {
                    gate.connected(&fingerprint);
                    *admitted = Some(fingerprint);
                    true
                }
                _ => false,
            }
        }
        Event::ChannelData(data) => {
            let Some(presented) = admitted.as_deref() else {
                return true;
            };
            if data.binary {
                return true;
            }
            let Ok(request) = std::str::from_utf8(&data.data) else {
                return true;
            };
            let reply = gate.answer(presented, local, request);
            if let Some(mut channel) = rtc.channel(data.id) {
                let _ = channel.write(false, reply.as_bytes());
            }
            true
        }
        Event::IceConnectionStateChange(IceConnectionState::Disconnected) => false,
        _ => true,
    }
}

#[cfg(test)]
#[path = "tests/peer.rs"]
mod tests;
