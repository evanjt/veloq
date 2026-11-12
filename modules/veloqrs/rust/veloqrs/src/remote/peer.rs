//! One linked browser's connection: a WebRTC data channel the engine serves.
//!
//! The browser offers, the phone answers. An offer whose certificate is not
//! pinned is refused before any answer is made, and the certificate the
//! handshake presents is checked again once the connection is up, so no
//! request is read and no byte is answered for a peer that is not linked.

use std::collections::VecDeque;
use std::io::ErrorKind;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::DisconnectReason;
use super::asks::{Conn, Pool, Reply};
use super::protocol::{self, Incoming};
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

/// The longest the loop spends getting a farewell out once it is stopped.
const FAREWELL_LIMIT: Duration = Duration::from_millis(300);

/// The longest between two looks at whether the library changed.
const CHANGE_POLL: Duration = Duration::from_secs(1);

/// Reply messages waiting for room in a channel's send buffer, oldest first.
struct Outbox {
    frames: VecDeque<(ChannelId, super::protocol::Message)>,
    /// The protocol version the page last asked in, which the messages the
    /// phone sends unasked (a change, a farewell, a refusal) are written in.
    wire: u32,
}

impl Default for Outbox {
    fn default() -> Self {
        Self {
            frames: VecDeque::new(),
            wire: super::protocol::PROTOCOL_VERSION,
        }
    }
}

impl Outbox {
    /// Queue a reply in the format of protocol `wire`.
    fn push_in(&mut self, channel: ChannelId, reply: &str, wire: u32) {
        for message in super::protocol::messages(reply, wire) {
            self.frames.push_back((channel, message));
        }
    }

    /// Queue a message in the format the page last asked in.
    fn push(&mut self, channel: ChannelId, reply: &str) {
        self.push_in(channel, reply, self.wire);
    }

    fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Forget the frames not yet written of the reply to ask `id`.
    fn drop_reply(&mut self, id: u64) {
        let Ok(id) = u32::try_from(id) else {
            return;
        };
        self.frames
            .retain(|(_, message)| super::protocol::reply_id(message) != Some(id));
    }

    /// Write frames while the send buffer has room for the next one. A frame
    /// the buffer refuses stays at the head. Whether any frame was written,
    /// or an error when a channel is broken.
    fn flush(&mut self, rtc: &mut Rtc) -> Result<bool, ()> {
        let mut wrote = false;
        while let Some((id, message)) = self.frames.front() {
            let Some(mut channel) = rtc.channel(*id) else {
                self.frames.pop_front();
                continue;
            };
            match channel.write(message.binary, &message.bytes) {
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

/// What the connection asks of the engine. `answer` runs on a worker thread,
/// and several asks of one connection may be in it at once.
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
    /// A stamp that differs from the last one when the library has changed,
    /// or nothing when it cannot be read.
    fn changed(&self) -> Option<u64>;
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
    reason: Arc<Mutex<Option<DisconnectReason>>>,
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
    /// End the connection and wait for its thread. The browser is told
    /// `reason` on the open channel first, within a bounded time.
    pub fn stop(mut self, reason: DisconnectReason) {
        *self
            .reason
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(reason);
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

    let pool = Pool::shared().map_err(|error| Refusal::Network(error.to_string()))?;
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let reason = Arc::new(Mutex::new(None));
    let said = Arc::clone(&reason);
    let thread = std::thread::Builder::new()
        .name("remote-peer".into())
        .spawn(move || {
            serve(
                rtc,
                socket,
                gate,
                &pool,
                &local_fingerprint,
                &flag,
                &said,
                stun.map(|s| s.server),
                poll,
            )
        })
        .map_err(|error| Refusal::Network(error.to_string()))?;
    Ok((
        answer,
        Peer {
            stop,
            reason,
            thread: Some(thread),
            wake: wake_address(local),
        },
    ))
}

/// A peer whose certificate was pinned when the connection came up.
struct Admitted {
    fingerprint: String,
    asks: Arc<Conn>,
    replies: Receiver<Reply>,
}

impl Admitted {
    /// Move the replies the workers have made into the outbox.
    fn collect(&self, outbox: &mut Outbox) {
        while let Ok((channel, reply, wire)) = self.replies.try_recv() {
            outbox.push_in(channel, &reply, wire);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn serve(
    mut rtc: Rtc,
    socket: UdpSocket,
    gate: Arc<dyn Gate>,
    pool: &Pool,
    fingerprint: &str,
    stop: &AtomicBool,
    reason: &Mutex<Option<DisconnectReason>>,
    stun_server: Option<SocketAddr>,
    poll: Duration,
) {
    let mut admitted: Option<Admitted> = None;
    let mut outbox = Outbox::default();
    let mut stamp: Option<u64> = None;
    let mut channel: Option<ChannelId> = None;
    let mut looked = Instant::now();
    let mut buf = vec![0u8; 2000];
    let Ok(local) = socket.local_addr() else {
        return;
    };
    while rtc.is_alive() && !stop.load(Ordering::Relaxed) {
        let deadline = match rtc.poll_output() {
            Ok(Output::Timeout(at)) => {
                if let Some(admitted) = &admitted {
                    admitted.collect(&mut outbox);
                }
                match outbox.flush(&mut rtc) {
                    Err(()) => break,
                    Ok(true) => continue,
                    Ok(false) => at,
                }
            }
            Ok(Output::Transmit(out)) => {
                let _ = socket.send_to(&out.contents, out.destination);
                continue;
            }
            Ok(Output::Event(event)) => {
                if let Event::ChannelOpen(id, _) = &event {
                    channel = Some(*id);
                }
                if !on_event(
                    &mut rtc,
                    event,
                    &gate,
                    pool,
                    fingerprint,
                    &mut admitted,
                    &mut outbox,
                ) {
                    break;
                }
                if admitted.is_some() && stamp.is_none() {
                    stamp = gate.changed();
                    looked = Instant::now();
                }
                continue;
            }
            Err(_) => break,
        };
        if admitted.is_some() && looked.elapsed() >= CHANGE_POLL {
            looked = Instant::now();
            if let Some(now) = gate.changed() {
                if stamp.is_some_and(|seen| seen != now)
                    && let Some(channel) = channel
                {
                    outbox.push(channel, &announcement(now));
                }
                stamp = Some(now);
            }
        }
        let mut wait = deadline.saturating_duration_since(Instant::now()).min(poll);
        if admitted.is_some() {
            // The library is looked at about once a second however long the
            // idle poll is, so a change reaches the browser on time.
            wait = wait.min(CHANGE_POLL.saturating_sub(looked.elapsed()));
        }
        if !outbox.is_empty() || admitted.as_ref().is_some_and(|a| a.asks.busy()) {
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
    let reason = *reason
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(reason) = reason
        && let Some(channel) = channel
        && rtc.is_alive()
    {
        say_farewell(&mut rtc, &socket, &mut outbox, channel, reason);
    }
    rtc.disconnect();
    if let Some(admitted) = admitted {
        admitted.asks.close();
        gate.disconnected(&admitted.fingerprint);
    }
}

/// The unsolicited frame that tells a browser why the phone is leaving. It
/// goes under request id 0, as the change announcement does.
fn farewell(reason: DisconnectReason) -> String {
    serde_json::json!({ "event": "farewell", "reason": reason }).to_string()
}

/// Send the farewell on the open channel, for no longer than
/// `FAREWELL_LIMIT`. Replies still queued are dropped first: the connection
/// is ending, and a browser mid-way through a large reply would otherwise wait
/// behind it and be cut off as it would be without a reason.
fn say_farewell(
    rtc: &mut Rtc,
    socket: &UdpSocket,
    outbox: &mut Outbox,
    channel: ChannelId,
    reason: DisconnectReason,
) {
    outbox.frames.clear();
    outbox.push(channel, &farewell(reason));
    let until = Instant::now() + FAREWELL_LIMIT;
    while Instant::now() < until {
        if outbox.flush(rtc).is_err() {
            break;
        }
        match rtc.poll_output() {
            Ok(Output::Transmit(out)) => {
                let _ = socket.send_to(&out.contents, out.destination);
            }
            Ok(Output::Event(_)) => {}
            Ok(Output::Timeout(_)) if !outbox.is_empty() => {
                if rtc.handle_input(Input::Timeout(Instant::now())).is_err() {
                    break;
                }
            }
            Ok(Output::Timeout(_)) | Err(_) => break,
        }
    }
}

/// The unsolicited frame that tells a browser the library changed. It goes
/// under request id 0, which no request uses.
fn announcement(generation: u64) -> String {
    serde_json::json!({ "event": "changed", "generation": generation }).to_string()
}

/// Act on one event. False ends the connection.
fn on_event(
    rtc: &mut Rtc,
    event: Event,
    gate: &Arc<dyn Gate>,
    pool: &Pool,
    local: &str,
    admitted: &mut Option<Admitted>,
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
                    let (asks, replies) = Conn::new(Arc::clone(gate), &fingerprint, local);
                    *admitted = Some(Admitted {
                        fingerprint,
                        asks,
                        replies,
                    });
                    true
                }
                _ => false,
            }
        }
        Event::ChannelData(data) => {
            let Some(admitted) = admitted.as_ref() else {
                return true;
            };
            if data.binary {
                return true;
            }
            let Ok(request) = std::str::from_utf8(&data.data) else {
                return true;
            };
            match protocol::incoming(request) {
                Incoming::Cancel(id) => {
                    admitted.asks.cancel(id);
                    // A reply made just before the cancel is not sent.
                    admitted.collect(outbox);
                    outbox.drop_reply(id);
                }
                Incoming::Ask(id) => {
                    outbox.wire = protocol::wire_of(request);
                    if !admitted.asks.submit(pool, data.id, id, request) {
                        outbox.push(data.id, &protocol::busy(id));
                    }
                }
                Incoming::Ignore => {}
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
