//! One linked browser's connection: a WebRTC data channel the engine serves.
//!
//! The browser offers, the phone answers. An offer whose certificate is not
//! pinned is refused before any answer is made, and the certificate the
//! handshake presents is checked again once the connection is up, so no
//! request is read and no byte is answered for a peer that is not linked.

use std::collections::VecDeque;
use std::io::ErrorKind;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::stun::{self, Stun};
use str0m::change::{SdpAnswer, SdpOffer};
use str0m::channel::ChannelId;
use str0m::config::DtlsCert;
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

/// The longest the loop sleeps when str0m asks for no earlier wake. `Peer::stop`
/// ends a read at once with a datagram, so this only bounds a stuck timer.
const STOP_POLL: Duration = Duration::from_secs(5);

/// How long the loop sleeps at most while reply frames wait for room in a
/// channel's send buffer.
const DRAIN_POLL: Duration = Duration::from_millis(5);

/// Reply frames waiting for room in a channel's send buffer, oldest first.
#[derive(Default)]
struct Outbox {
    frames: VecDeque<(ChannelId, Vec<u8>)>,
}

impl Outbox {
    fn push(&mut self, channel: ChannelId, reply: &str) {
        for frame in super::protocol::frames(reply) {
            self.frames.push_back((channel, frame));
        }
    }

    fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Write frames while the send buffer has room for the next one. A frame
    /// the buffer refuses stays at the head. Whether any frame was written,
    /// or an error when a channel is broken.
    fn flush(&mut self, rtc: &mut Rtc) -> Result<bool, ()> {
        let mut wrote = false;
        while let Some((id, frame)) = self.frames.front() {
            let Some(mut channel) = rtc.channel(*id) else {
                self.frames.pop_front();
                continue;
            };
            match channel.write(true, frame) {
                Ok(true) => {
                    self.frames.pop_front();
                    wrote = true;
                }
                Ok(false) => break,
                Err(error) => {
                    log::warn!("remote link: a reply could not be written: {error}");
                    return Err(());
                }
            }
        }
        Ok(wrote)
    }
}

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
    /// Where an empty datagram reaches the connection's socket.
    wake: SocketAddr,
}

/// The address a datagram sent to a socket bound to `bound` reaches: an
/// unspecified bound address is reached through the loopback of its family.
fn wake_address(bound: SocketAddr) -> SocketAddr {
    let ip = match bound.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(std::net::Ipv6Addr::LOCALHOST),
        ip => ip,
    };
    SocketAddr::new(ip, bound.port())
}

impl Peer {
    /// End the connection and wait for its thread.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        // An empty datagram ends the thread's read now; the loop drops it.
        if let Ok(waker) = UdpSocket::bind(SocketAddr::new(
            if self.wake.is_ipv4() {
                IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED)
            } else {
                IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED)
            },
            0,
        )) {
            let _ = waker.send_to(&[], self.wake);
        }
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
/// its remote description. With `stun`, the phone first learns its public
/// address from that server and offers it beside the local one; a server that
/// does not answer leaves the local address alone.
pub fn accept(
    offer: &str,
    cert: DtlsCert,
    bind: IpAddr,
    gate: Arc<dyn Gate>,
    stun: Option<Stun>,
) -> Result<(String, Peer), Refusal> {
    accept_polling(offer, cert, bind, gate, stun, STOP_POLL)
}

/// `accept` with the longest idle sleep the loop takes given.
fn accept_polling(
    offer: &str,
    cert: DtlsCert,
    bind: IpAddr,
    gate: Arc<dyn Gate>,
    stun: Option<Stun>,
    poll: Duration,
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
    if let Some(stun) = stun
        && let Some(public) = stun::mapped_address(&socket, stun)
        && let Ok(reflexive) = Candidate::server_reflexive(public, local, "udp")
    {
        rtc.add_local_candidate(reflexive);
    }
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
        .spawn(move || {
            serve(
                rtc,
                socket,
                gate,
                &local_fingerprint,
                &flag,
                stun.map(|s| s.server),
                poll,
            )
        })
        .map_err(|error| Refusal::Network(error.to_string()))?;
    Ok((
        answer,
        Peer {
            stop,
            thread: Some(thread),
            wake: wake_address(local),
        },
    ))
}

fn serve(
    mut rtc: Rtc,
    socket: UdpSocket,
    gate: Arc<dyn Gate>,
    fingerprint: &str,
    stop: &AtomicBool,
    stun_server: Option<SocketAddr>,
    poll: Duration,
) {
    let mut admitted: Option<String> = None;
    let mut outbox = Outbox::default();
    let mut buf = vec![0u8; 2000];
    let Ok(local) = socket.local_addr() else {
        return;
    };
    while rtc.is_alive() && !stop.load(Ordering::Relaxed) {
        let deadline = match rtc.poll_output() {
            Ok(Output::Timeout(at)) => match outbox.flush(&mut rtc) {
                Err(()) => break,
                Ok(true) => continue,
                Ok(false) => at,
            },
            Ok(Output::Transmit(out)) => {
                let _ = socket.send_to(&out.contents, out.destination);
                continue;
            }
            Ok(Output::Event(event)) => {
                if !on_event(
                    &mut rtc,
                    event,
                    &*gate,
                    fingerprint,
                    &mut admitted,
                    &mut outbox,
                ) {
                    break;
                }
                continue;
            }
            Err(_) => break,
        };
        let mut wait = deadline.saturating_duration_since(Instant::now()).min(poll);
        if !outbox.is_empty() {
            wait = wait.min(DRAIN_POLL);
        }
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
                if n == 0 || Some(source) == stun_server {
                    continue;
                }
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
    outbox: &mut Outbox,
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
            outbox.push(data.id, &reply);
            true
        }
        Event::IceConnectionStateChange(IceConnectionState::Disconnected) => false,
        _ => true,
    }
}

#[cfg(test)]
#[path = "tests/peer.rs"]
mod tests;
