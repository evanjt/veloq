//! A browser stand-in offers over loopback UDP and asks over the data channel.

use super::super::protocol::{
    FRAME_BYTES, FRAME_GZIP, FRAME_HEADER_BYTES, FRAME_LAST, FRAME_VERSION,
};
use super::*;
use crate::poison::Recover;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize};

use str0m::change::SdpPendingOffer;

const ASK: &str = r#"{"id":1,"method":"feed.page","protocol":3}"#;
const ASK_OLDER: &str = r#"{"id":2,"method":"feed.page"}"#;

/// Answers every request with a fixed reply, pins a set the test controls,
/// and counts the connections it saw.
struct TestGate {
    pinned: Mutex<Vec<String>>,
    /// Pin checks to answer before every later one is refused, for a device
    /// removed while its connection comes up.
    allow_checks: Option<AtomicUsize>,
    connected: AtomicUsize,
    disconnected: AtomicUsize,
    /// Calls of `answer` that returned.
    answered: AtomicUsize,
    /// The stamp `changed` reports.
    stamp: AtomicU64,
    /// Binary messages the peer passed on, with the fingerprint each came from.
    frames: Mutex<Vec<(String, Vec<u8>)>>,
}

impl TestGate {
    fn pinning(fingerprint: Option<&str>) -> Arc<Self> {
        Arc::new(Self {
            pinned: Mutex::new(fingerprint.into_iter().map(String::from).collect()),
            allow_checks: None,
            connected: AtomicUsize::new(0),
            disconnected: AtomicUsize::new(0),
            answered: AtomicUsize::new(0),
            stamp: AtomicU64::new(1),
            frames: Mutex::new(Vec::new()),
        })
    }
}

impl Gate for TestGate {
    fn is_pinned(&self, fingerprint: &str) -> bool {
        if let Some(left) = &self.allow_checks
            && left
                .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_err()
        {
            return false;
        }
        self.pinned.lock().unwrap().iter().any(|p| p == fingerprint)
    }
    fn answer(&self, _presented: &str, _local: &str, request: &str) -> String {
        let reply = self.reply(request);
        self.answered.fetch_add(1, Ordering::SeqCst);
        reply
    }
    fn connected(&self, _fingerprint: &str, _from: Option<SocketAddr>, _local: SocketAddr) {
        self.connected.fetch_add(1, Ordering::SeqCst);
    }
    fn disconnected(&self, _fingerprint: &str, _reason: Option<DisconnectReason>) {
        self.disconnected.fetch_add(1, Ordering::SeqCst);
    }
    fn changed(&self) -> Option<u64> {
        Some(self.stamp.load(Ordering::SeqCst))
    }
    fn frame(&self, presented: &str, bytes: &[u8]) {
        self.frames
            .lock()
            .unwrap()
            .push((presented.to_owned(), bytes.to_vec()));
    }
}

impl TestGate {
    fn reply(&self, request: &str) -> String {
        if let Ok(ask) = serde_json::from_str::<serde_json::Value>(request) {
            match ask["method"].as_str() {
                Some("sleep") => {
                    std::thread::sleep(Duration::from_millis(
                        ask["params"]["ms"].as_u64().unwrap(),
                    ));
                    return serde_json::json!({ "id": ask["id"], "result": "slept" }).to_string();
                }
                Some("echo") => {
                    return serde_json::json!({ "id": ask["id"], "result": "echoed" }).to_string();
                }
                Some("explode") => panic!("a read that panics"),
                _ => {}
            }
        }
        if let Ok(ask) = serde_json::from_str::<serde_json::Value>(request)
            && ask["method"] == "blob"
        {
            let size = ask["params"]["size"].as_u64().unwrap() as usize;
            let text = match ask["params"]["kind"].as_str() {
                Some("noise") => noise(size),
                _ => "0123456789".repeat(size / 10),
            };
            return serde_json::json!({ "id": ask["id"], "result": text }).to_string();
        }
        format!("answered {request}")
    }
}

/// Text that gzip cannot shrink much, so a reply of it stays large on the wire.
fn noise(size: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut state = 0x9E37_79B9u32;
    (0..size)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            char::from(ALPHABET[(state >> 8) as usize % ALPHABET.len()])
        })
        .collect()
}

fn certificate() -> DtlsCert {
    crate::remote::install_crypto();
    str0m::crypto::from_feature_flags()
        .dtls_provider
        .generate_certificate()
        .expect("certificate")
}

struct Browser {
    rtc: Rtc,
    socket: UdpSocket,
    pending: Option<SdpPendingOffer>,
    fingerprint: String,
    /// Replies that arrived as text messages, in the order they arrived.
    texts: Vec<String>,
    /// Binary messages sent once the channel opens, before any ask.
    uploads: Vec<Vec<u8>>,
    /// The channel the phone opened, once it has.
    channel: Option<ChannelId>,
}

impl Browser {
    fn new() -> (Self, String) {
        Self::with_certificate(certificate())
    }

    /// A browser presenting `cert`, so a second connection can be the same device.
    fn with_certificate(cert: DtlsCert) -> (Self, String) {
        crate::remote::install_crypto();
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mut rtc = RtcConfig::new().set_dtls_cert(cert).build(Instant::now());
        rtc.add_local_candidate(Candidate::host(socket.local_addr().unwrap(), "udp").unwrap());
        let mut change = rtc.sdp_api();
        change.add_channel("library".into());
        let (offer, pending) = change.apply().expect("an offer");
        let shown = rtc.direct_api().local_dtls_fingerprint().to_string();
        let (hash, hex) = shown.split_once(' ').unwrap();
        let fingerprint = normalise(hash, hex);
        let offer = serde_json::to_string(&offer).unwrap();
        (
            Self {
                rtc,
                socket,
                pending: Some(pending),
                fingerprint,
                texts: Vec::new(),
                uploads: Vec::new(),
                channel: None,
            },
            offer,
        )
    }

    fn take_answer(&mut self, answer: &str) {
        let answer: SdpAnswer = serde_json::from_str(answer).unwrap();
        self.rtc
            .sdp_api()
            .accept_answer(self.pending.take().unwrap(), answer)
            .unwrap();
    }

    /// Drive the connection until `until` is true or it ends. Sends `ask` once
    /// the channel opens, and returns every reply the channel carried.
    fn run(&mut self, ask: &str, until: Duration) -> (bool, Vec<Vec<u8>>) {
        self.run_asks(&[ask.to_string()], 1, until)
    }

    /// As `run`, sending every ask once the channel opens and stopping once
    /// `want` replies are complete, a reply being complete at its last frame.
    fn run_asks(&mut self, asks: &[String], want: usize, until: Duration) -> (bool, Vec<Vec<u8>>) {
        self.run_script(asks, &[], Duration::ZERO, want, until)
    }

    /// As `run_asks`, and `late` is sent once the channel has been open for
    /// `late_after`.
    fn run_script(
        &mut self,
        asks: &[String],
        late: &[String],
        late_after: Duration,
        want: usize,
        until: Duration,
    ) -> (bool, Vec<Vec<u8>>) {
        let mut complete = 0;
        let started = Instant::now();
        let mut opened = false;
        let mut open_at: Option<(ChannelId, Instant)> = None;
        let mut replies = Vec::new();
        let mut buf = vec![0u8; 2000];
        let local = self.socket.local_addr().unwrap();
        while started.elapsed() < until && self.rtc.is_alive() && complete < want {
            match self.rtc.poll_output().unwrap() {
                Output::Transmit(out) => {
                    let _ = self.socket.send_to(&out.contents, out.destination);
                }
                Output::Event(Event::ChannelOpen(id, _)) => {
                    opened = true;
                    self.channel = Some(id);
                    open_at = Some((id, Instant::now()));
                    for upload in &self.uploads {
                        self.rtc.channel(id).unwrap().write(true, upload).unwrap();
                    }
                    for ask in asks {
                        self.rtc
                            .channel(id)
                            .unwrap()
                            .write(false, ask.as_bytes())
                            .unwrap();
                    }
                }
                Output::Event(Event::ChannelData(data)) => {
                    if data.binary {
                        if data.data[1] & FRAME_LAST != 0 {
                            complete += 1;
                        }
                        replies.push(data.data);
                    } else {
                        complete += 1;
                        self.texts.push(String::from_utf8(data.data).unwrap());
                    }
                }
                Output::Event(_) => {}
                Output::Timeout(at) => {
                    if let Some((id, since)) = open_at
                        && !late.is_empty()
                        && since.elapsed() >= late_after
                    {
                        open_at = None;
                        for ask in late {
                            self.rtc
                                .channel(id)
                                .unwrap()
                                .write(false, ask.as_bytes())
                                .unwrap();
                        }
                    }
                    let wait = at
                        .saturating_duration_since(Instant::now())
                        .clamp(Duration::from_millis(1), Duration::from_millis(50));
                    self.socket.set_read_timeout(Some(wait)).unwrap();
                    buf.resize(2000, 0);
                    let input = match self.socket.recv_from(&mut buf) {
                        Ok((n, source)) => {
                            buf.truncate(n);
                            Input::Receive(
                                Instant::now(),
                                Receive {
                                    proto: Protocol::Udp,
                                    source,
                                    destination: local,
                                    contents: buf.as_slice().try_into().unwrap(),
                                },
                            )
                        }
                        Err(_) => Input::Timeout(Instant::now()),
                    };
                    if self.rtc.handle_input(input).is_err() {
                        break;
                    }
                }
            }
        }
        (opened, replies)
    }
}

#[path = "export_link.rs"]
mod export_link;

fn loopback() -> IpAddr {
    "127.0.0.1".parse().unwrap()
}

/// Scenario: a pinned browser sends two binary messages and then a text ask.
/// Expected behaviour: the gate is handed both messages whole, in order, under
/// the browser's fingerprint, and the text ask is answered as before.
#[test]
fn binary_data_from_a_pinned_browser_reaches_the_gate_whole_and_in_order() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) =
        accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);
    let first = vec![1u8; 16 * 1024 + 10];
    let second = vec![2u8; 700];
    browser.uploads = vec![first.clone(), second.clone()];

    let (opened, replies) = browser.run(ASK, Duration::from_secs(10));

    assert!(opened);
    assert_eq!(joined(&replies)[&0], format!("answered {ASK}"));
    let held = gate.frames.lock().unwrap().clone();
    assert_eq!(
        held,
        vec![
            (browser.fingerprint.clone(), first),
            (browser.fingerprint.clone(), second)
        ]
    );
    peer.stop(DisconnectReason::Disconnected);
}

#[test]
fn a_pinned_browser_gets_an_answer_over_the_channel() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) =
        accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);

    let (opened, replies) = browser.run(ASK, Duration::from_secs(10));
    assert!(opened);
    assert_eq!(joined(&replies)[&0], format!("answered {ASK}"));
    assert_eq!(gate.connected.load(Ordering::SeqCst), 1);

    peer.stop(DisconnectReason::Disconnected);
    assert_eq!(gate.disconnected.load(Ordering::SeqCst), 1);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn stop_ends_a_read_that_would_otherwise_never_return() {
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let wake = socket.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        let mut buf = [0u8; 16];
        let _ = socket.recv_from(&mut buf);
    });
    Peer {
        stop: Arc::new(AtomicBool::new(false)),
        reason: Arc::new(Mutex::new(None)),
        up: Arc::new(AtomicBool::new(false)),
        thread: Some(thread),
        wake,
    }
    .stop(DisconnectReason::Disconnected);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_unspecified_bind_is_woken_through_loopback() {
    assert_eq!(
        wake_address("0.0.0.0:4000".parse().unwrap()),
        "127.0.0.1:4000".parse().unwrap()
    );
    assert_eq!(
        wake_address("[::]:4000".parse().unwrap()),
        "[::1]:4000".parse().unwrap()
    );
    assert_eq!(
        wake_address("192.0.2.7:4000".parse().unwrap()),
        "192.0.2.7:4000".parse().unwrap()
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn stop_returns_on_a_connection_whose_poll_is_an_hour() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) = accept_polling(
        &offer,
        certificate(),
        loopback(),
        gate.clone(),
        None,
        Duration::from_secs(3600),
        Duration::from_secs(3600),
    )
    .expect("accepted");
    browser.take_answer(&answer);
    let (opened, _) = browser.run(ASK, Duration::from_secs(10));
    assert!(opened);

    peer.stop(DisconnectReason::Disconnected);
    assert_eq!(gate.disconnected.load(Ordering::SeqCst), 1);
}

/// Scenario: a page built for the previous protocol asks with no protocol
/// field and reads text messages. Expected behaviour: its reply is one text
/// message, not frames, and a request naming the current protocol still gets
/// frames on the same connection.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_request_with_no_protocol_gets_a_text_reply_and_a_current_one_gets_frames() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) = accept(&offer, certificate(), loopback(), gate, None).expect("accepted");
    browser.take_answer(&answer);

    let (opened, frames) = browser.run_asks(
        &[ASK_OLDER.to_string(), ASK.to_string()],
        2,
        Duration::from_secs(10),
    );
    assert!(opened);
    assert_eq!(browser.texts, vec![format!("answered {ASK_OLDER}")]);
    assert_eq!(joined(&frames)[&0], format!("answered {ASK}"));
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: a page asks in a version this phone does not speak, then in one it does.
/// Expected behaviour: the first is answered at once as one text error naming the
/// phone's range and is never run; the second is run and answered as usual.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_ask_in_a_version_outside_the_window_is_refused_as_text_and_never_run() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) =
        accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);

    let refused = r#"{"id":3,"method":"feed.page","protocol":9}"#;
    let (opened, _) = browser.run_asks(
        &[refused.to_string(), ASK.to_string()],
        2,
        Duration::from_secs(10),
    );
    assert!(opened);
    let texts: Vec<serde_json::Value> = browser
        .texts
        .iter()
        .map(|text| serde_json::from_str(text).expect("a JSON reply"))
        .collect();
    assert_eq!(
        texts,
        vec![serde_json::json!({
            "id": 3,
            "error": protocol::VERSION,
            "minProtocol": protocol::MIN_PROTOCOL_VERSION,
            "maxProtocol": protocol::PROTOCOL_VERSION,
        })]
    );
    assert_eq!(
        gate.answered.load(Ordering::SeqCst),
        1,
        "only the valid ask ran"
    );
    peer.stop(DisconnectReason::Disconnected);
}

/// The replies a browser holds, each frame set joined and inflated as the
/// page does, keyed by request id. Every frame is checked against the limit.
fn joined(messages: &[Vec<u8>]) -> std::collections::BTreeMap<u32, String> {
    let mut parts: std::collections::HashMap<u32, (Vec<u8>, u32)> = Default::default();
    let mut done = std::collections::BTreeMap::new();
    for frame in messages {
        assert!(
            frame.len() <= FRAME_BYTES,
            "a frame of {} bytes",
            frame.len()
        );
        assert_eq!(frame[0], FRAME_VERSION);
        let id = u32::from_be_bytes(frame[2..6].try_into().unwrap());
        let seq = u32::from_be_bytes(frame[6..10].try_into().unwrap());
        let (body, next) = parts.entry(id).or_default();
        assert_eq!(seq, *next, "frames of {id} out of order");
        *next += 1;
        body.extend_from_slice(&frame[FRAME_HEADER_BYTES..]);
        if frame[1] & FRAME_LAST != 0 {
            let (body, _) = parts.remove(&id).unwrap();
            let text = if frame[1] & FRAME_GZIP != 0 {
                let mut text = String::new();
                std::io::Read::read_to_string(
                    &mut flate2::read::GzDecoder::new(&body[..]),
                    &mut text,
                )
                .unwrap();
                text
            } else {
                String::from_utf8(body).unwrap()
            };
            done.insert(id, text);
        }
    }
    done
}

fn blob(id: u64, size: usize, kind: &str) -> String {
    serde_json::json!({ "id": id, "method": "blob", "protocol": 3, "params": { "size": size, "kind": kind } })
        .to_string()
}

fn result_of(reply: &str) -> String {
    serde_json::from_str::<serde_json::Value>(reply).unwrap()["result"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Scenario: a reply is larger than the data channel's send buffer even
/// gzipped. Expected behaviour: it arrives whole and byte for byte, in frames
/// none over the limit.
#[test]
fn a_reply_larger_than_the_send_buffer_arrives_whole() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) = accept(&offer, certificate(), loopback(), gate, None).expect("accepted");
    browser.take_answer(&answer);

    let size = 300 * 1024;
    let (_opened, messages) =
        browser.run_asks(&[blob(1, size, "noise")], 1, Duration::from_secs(20));
    assert!(messages.len() > 8);
    let replies = joined(&messages);
    assert_eq!(result_of(&replies[&1]), noise(size));
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: sixteen asks go out back to back and every reply outgrows the
/// room left by the one before. Expected behaviour: all sixteen arrive.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn sixteen_large_replies_sent_back_to_back_all_arrive() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) = accept(&offer, certificate(), loopback(), gate, None).expect("accepted");
    browser.take_answer(&answer);

    let asks: Vec<String> = (1..=16).map(|id| blob(id, 16 * 1024, "noise")).collect();
    let (_opened, messages) = browser.run_asks(&asks, 16, Duration::from_secs(30));
    let replies = joined(&messages);
    assert_eq!(replies.len(), 16);
    for id in 1..=16u32 {
        assert_eq!(result_of(&replies[&id]), noise(16 * 1024));
    }
    peer.stop(DisconnectReason::Disconnected);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_one_megabyte_reply_travels_gzipped_in_fewer_bytes_than_it_measures() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) = accept(&offer, certificate(), loopback(), gate, None).expect("accepted");
    browser.take_answer(&answer);

    let (_opened, messages) = browser.run_asks(
        &[blob(1, 1024 * 1024, "digits")],
        1,
        Duration::from_secs(20),
    );
    assert_eq!(messages[0][1] & FRAME_GZIP, FRAME_GZIP);
    let wire: usize = messages.iter().map(Vec::len).sum();
    let replies = joined(&messages);
    assert_eq!(
        result_of(&replies[&1]),
        "0123456789".repeat(1024 * 1024 / 10)
    );
    assert!(wire < replies[&1].len(), "{wire} bytes on the channel");
    peer.stop(DisconnectReason::Disconnected);
}

#[test]
fn an_unpinned_browser_is_refused_before_any_answer() {
    let (_browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some("sha-256 00:11"));
    let refused = accept(&offer, certificate(), loopback(), gate.clone(), None);
    assert_eq!(refused.err(), Some(Refusal::NotPinned));
    assert_eq!(gate.connected.load(Ordering::SeqCst), 0);
}

#[test]
fn a_device_removed_while_it_connects_gets_no_byte() {
    let (mut browser, offer) = Browser::new();
    let gate = Arc::new(TestGate {
        pinned: Mutex::new(vec![browser.fingerprint.clone()]),
        allow_checks: Some(AtomicUsize::new(1)),
        connected: AtomicUsize::new(0),
        disconnected: AtomicUsize::new(0),
        answered: AtomicUsize::new(0),
        stamp: AtomicU64::new(1),
        frames: Mutex::new(Vec::new()),
    });
    let (answer, peer) =
        accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);

    let (_opened, replies) = browser.run(ASK, Duration::from_secs(5));
    assert!(
        replies.is_empty(),
        "a removed device was answered: {replies:?}"
    );
    assert_eq!(gate.connected.load(Ordering::SeqCst), 0);
    peer.stop(DisconnectReason::Disconnected);
}

#[test]
fn a_malformed_offer_is_refused() {
    let gate = TestGate::pinning(None);
    assert!(matches!(
        accept("not json", certificate(), loopback(), gate, None),
        Err(Refusal::Malformed(_))
    ));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_offered_fingerprint_is_read_in_one_spelling() {
    let sdp = "v=0\r\na=fingerprint:SHA-256 ab:cd:ef\r\n";
    assert_eq!(
        offered_fingerprint(sdp).as_deref(),
        Some("sha-256 AB:CD:EF")
    );
    assert_eq!(offered_fingerprint("v=0\r\n"), None);
}

fn sleep(id: u64, ms: u64) -> String {
    serde_json::json!({ "id": id, "method": "sleep", "protocol": 3, "params": { "ms": ms } })
        .to_string()
}

fn echo(id: u64) -> String {
    serde_json::json!({ "id": id, "method": "echo", "protocol": 3 }).to_string()
}

fn cancel(id: u64) -> String {
    serde_json::json!({ "method": "cancel", "params": { "id": id } }).to_string()
}

/// The worker threads are shared by every connection in the process, so a
/// test that counts on them being free holds this while it runs.
static WORKERS: Mutex<()> = Mutex::new(());

/// A pinned browser and the connection serving it, with the workers held.
fn linked() -> (
    Browser,
    Arc<TestGate>,
    Peer,
    std::sync::MutexGuard<'static, ()>,
) {
    let held = WORKERS.lock_recover();
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) =
        accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);
    (browser, gate, peer, held)
}

/// The ids of the replies a browser holds, in the order their last frames came.
fn order_of(messages: &[Vec<u8>]) -> Vec<u32> {
    messages
        .iter()
        .filter(|frame| frame[1] & FRAME_LAST != 0)
        .map(|frame| u32::from_be_bytes(frame[2..6].try_into().unwrap()))
        .collect()
}

/// Scenario: a read that takes half a second is asked, then a quick one.
/// Expected behaviour: the quick one is answered first and the slow one's
/// reply still arrives.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_quick_ask_is_answered_while_a_slow_one_runs() {
    let (mut browser, gate, peer, _held) = linked();

    let asks = [sleep(1, 500), echo(2)];
    let (_opened, messages) = browser.run_asks(&asks, 2, Duration::from_secs(10));
    assert_eq!(order_of(&messages), vec![2, 1]);
    assert_eq!(gate.answered.load(Ordering::SeqCst), 2);
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: seventeen asks arrive back to back. Expected behaviour: sixteen
/// are answered and the seventeenth is told the connection is busy.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_ask_past_sixteen_outstanding_is_answered_busy() {
    let (mut browser, _gate, peer, _held) = linked();

    let asks: Vec<String> = (1..=17).map(|id| sleep(id, 100)).collect();
    let (_opened, messages) = browser.run_asks(&asks, 17, Duration::from_secs(20));
    let replies = joined(&messages);
    assert_eq!(replies.len(), 17);
    let busy: Vec<u32> = replies
        .iter()
        .filter(|(_, text)| text.contains("\"error\":\"busy\""))
        .map(|(id, _)| *id)
        .collect();
    assert_eq!(busy, vec![17]);
    assert_eq!(order_of(&messages)[0], 17, "busy answers at once");
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: an ask arrives under an id no frame can carry. Expected behaviour:
/// it is refused as one text reply under the id it sent, and it is never run.
/// No binary frame is written, so none lands under the id events use.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_ask_under_an_id_a_frame_cannot_carry_is_refused_as_text_and_not_run() {
    let (mut browser, _gate, peer, _held) = linked();
    let past = u64::from(u32::MAX) + 1;

    let (_opened, messages) = browser.run(&echo(past), Duration::from_secs(10));
    assert!(messages.is_empty(), "a frame was written for the refusal");
    assert_eq!(
        browser.texts,
        vec![serde_json::json!({ "id": past, "error": "bad id" }).to_string()]
    );
    peer.stop(DisconnectReason::Disconnected);
}

/// A channel id, which str0m hands out only for a channel it opened.
fn some_channel() -> ChannelId {
    let mut rtc = RtcConfig::new().build(Instant::now());
    let mut change = rtc.sdp_api();
    let id = change.add_channel("library".into());
    let _ = change.apply();
    id
}

/// Scenario: a browser asks for large replies and never reads them, so every
/// reply waits in the phone's send queue. Expected behaviour: asks whose
/// replies are still unsent count as outstanding, so the seventeenth is
/// refused, and one is admitted again once a reply's last frame is written.
#[test]
fn an_ask_whose_reply_is_unsent_still_counts_as_outstanding() {
    let _held = WORKERS.lock_recover();
    let gate = TestGate::pinning(None);
    let (asks, replies) = Conn::new(gate, "presented", "local");
    let pool = Pool::shared().expect("a pool");
    let channel = some_channel();
    for id in 1..=16u64 {
        assert!(asks.submit(&pool, channel, Some(id), &echo(id)));
    }
    let mut held = Vec::new();
    while held.len() < 16 {
        held.push(
            replies
                .recv_timeout(Duration::from_secs(10))
                .expect("a reply"),
        );
    }
    assert!(
        !asks.submit(&pool, channel, Some(17), &echo(17)),
        "sixteen replies are waiting to be written"
    );
    asks.release(1);
    assert!(asks.submit(&pool, channel, Some(17), &echo(17)));
    asks.close();
}

/// Scenario: a browser asks sixteen large reads and never reads a reply, so
/// the outbox's channel never drains. Expected behaviour: every reply waits in
/// the outbox and none is released, the seventeenth ask is refused so it is
/// answered busy, and the outbox holds no more than sixteen replies' bytes.
#[test]
fn an_outbox_behind_a_channel_that_never_drains_stays_within_sixteen_replies() {
    const SIZE: usize = 256 * 1024;
    let _held = WORKERS.lock_recover();
    let gate = TestGate::pinning(None);
    let (asks, replies) = Conn::new(gate, "presented", "local");
    let admitted = Admitted {
        fingerprint: "presented".into(),
        asks: Arc::clone(&asks),
        replies,
    };
    let pool = Pool::shared().expect("a pool");
    let channel = some_channel();
    let mut outbox = Outbox::default();
    for id in 1..=16u64 {
        assert!(asks.submit(&pool, channel, Some(id), &blob(id, SIZE, "noise")));
    }
    let queued = |outbox: &Outbox| outbox.frames.iter().filter(|(_, _, last)| *last).count();
    for _ in 0..4000 {
        if queued(&outbox) == 16 {
            break;
        }
        admitted.collect(&mut outbox);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(queued(&outbox), 16, "replies never came");
    assert_eq!(outbox.take_released(), 0, "nothing was written");

    assert!(
        !asks.submit(&pool, channel, Some(17), &blob(17, SIZE, "noise")),
        "the seventeenth ask is refused while sixteen replies are unsent"
    );
    outbox.push(channel, &protocol::busy(Some(17)));
    let busy = outbox.frames.back().expect("a busy reply");
    assert!(String::from_utf8_lossy(&busy.1.bytes).contains("\"error\":\"busy\""));

    let cap = 16 * (SIZE + 4 * FRAME_BYTES);
    assert!(
        outbox.queued_bytes() >= 16 * SIZE / 2,
        "the replies are queued whole"
    );
    assert!(
        outbox.queued_bytes() < cap,
        "{} bytes queued",
        outbox.queued_bytes()
    );
    asks.close();
}

/// Scenario: replies sit in the outbox and the browser withdraws one.
/// Expected behaviour: the outbox reports each reply it drops unwritten, so
/// the connection stops counting that ask, and a message the phone sends
/// unasked is never reported.
#[test]
fn the_outbox_reports_each_reply_it_drops_unwritten() {
    let channel = some_channel();
    let mut outbox = Outbox::default();
    outbox.push_in(channel, &echo_reply(1), 3);
    outbox.push_in(channel, &echo_reply(2), 3);
    outbox.push(channel, &announcement(7));
    outbox.drop_reply(1);
    assert_eq!(outbox.take_released(), 1);
    assert_eq!(outbox.take_released(), 0);
}

fn echo_reply(id: u64) -> String {
    serde_json::json!({ "id": id, "result": "echoed" }).to_string()
}

/// Scenario: a change event is queued under id 0, the id events share, and
/// the browser cancels id 0. Expected behaviour: no ask holds id 0, so the
/// cancel drops nothing and the queued event still goes out.
#[test]
fn a_cancel_for_id_zero_drops_no_event() {
    let channel = some_channel();
    let mut outbox = Outbox::default();
    outbox.push(channel, &announcement(7));
    outbox.drop_reply(0);
    assert_eq!(outbox.frames.len(), 1);
    assert_eq!(outbox.take_released(), 0);
}

/// Scenario: both workers are held by slow asks, a third ask waits in the
/// queue and is cancelled, and a fourth follows. Expected behaviour: the third
/// is never run and never answered, the fourth is.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_cancelled_ask_still_in_the_queue_is_never_run() {
    let (mut browser, gate, peer, _held) = linked();

    let asks = [sleep(1, 500), sleep(2, 500), echo(3), cancel(3), echo(4)];
    let (_opened, messages) = browser.run_asks(&asks, 4, Duration::from_millis(2500));
    let mut ids = order_of(&messages);
    ids.sort_unstable();
    assert_eq!(ids, vec![1, 2, 4]);
    assert_eq!(gate.answered.load(Ordering::SeqCst), 3);
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: an ask is running when it is cancelled. Expected behaviour: it
/// finishes, because a read cannot be taken back, and no frame of its reply is
/// sent; an ask made after the cancel is answered.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_cancelled_ask_already_running_sends_no_frame() {
    let (mut browser, gate, peer, _held) = linked();

    let (_opened, messages) = browser.run_script(
        &[sleep(1, 600)],
        &[cancel(1), echo(2)],
        Duration::from_millis(200),
        2,
        Duration::from_millis(2500),
    );
    assert_eq!(order_of(&messages), vec![2]);
    assert!(
        messages
            .iter()
            .all(|frame| frame[2..6] != 1u32.to_be_bytes())
    );
    assert_eq!(gate.answered.load(Ordering::SeqCst), 2);
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: a cancel names an id nothing is waiting on. Expected behaviour:
/// it is ignored and the connection goes on answering.
#[test]
fn a_cancel_for_an_unknown_ask_changes_nothing() {
    let (mut browser, _gate, peer, _held) = linked();

    let asks = [cancel(99), echo(1)];
    let (_opened, messages) = browser.run_asks(&asks, 1, Duration::from_secs(10));
    assert_eq!(order_of(&messages), vec![1]);
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: a read panics on a worker. Expected behaviour: that ask is
/// answered with an error and the connection answers the next one.
#[test]
fn a_read_that_panics_is_an_error_and_the_connection_survives() {
    let (mut browser, _gate, peer, _held) = linked();

    let explode = serde_json::json!({ "id": 1, "method": "explode", "protocol": 3 }).to_string();
    let (_opened, messages) = browser.run_script(
        &[explode],
        &[echo(2)],
        Duration::from_millis(300),
        2,
        Duration::from_secs(10),
    );
    let replies = joined(&messages);
    assert!(replies[&1].contains("\"error\""), "{}", replies[&1]);
    assert!(replies[&2].contains("echoed"));
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: the library moves while a browser is connected.
/// Expected behaviour: the browser receives one event frame under request id
/// 0 for the new stamp, and none while the stamp stays.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_new_stamp_sends_one_changed_event_and_an_unchanged_one_sends_none() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) =
        accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);

    let (_opened, quiet) = browser.run_asks(&[], 1, Duration::from_secs(3));
    assert!(quiet.is_empty(), "an event with no change: {quiet:?}");

    let mover = Arc::clone(&gate);
    let moved = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        mover.stamp.store(2, Ordering::SeqCst);
    });
    let (_opened, messages) = browser.run_asks(&[], 1, Duration::from_secs(10));
    moved.join().unwrap();
    let events = joined(&messages);
    assert_eq!(events.len(), 1);
    let event: serde_json::Value = serde_json::from_str(&events[&0]).unwrap();
    assert_eq!(
        event,
        serde_json::json!({ "event": "changed", "generation": 2 })
    );

    let (_opened, after) = browser.run_asks(&[], 1, Duration::from_secs(3));
    assert!(after.is_empty(), "a second event for one change: {after:?}");
    peer.stop(DisconnectReason::Disconnected);
}

/// Scenario: the phone stops a connection that is up, with a reason.
/// Expected behaviour: the browser reads one farewell frame under request id
/// 0 naming the reason while its connection is still alive, so it need not
/// wait for the network to time out.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_stopped_peer_says_why_before_it_hangs_up() {
    for (reason, named) in [
        (DisconnectReason::Background, "background"),
        (DisconnectReason::SwitchedOff, "switchedOff"),
        (DisconnectReason::Removed, "removed"),
        (DisconnectReason::Disconnected, "disconnected"),
        (DisconnectReason::Declined, "declined"),
    ] {
        let (mut browser, offer) = Browser::new();
        let gate = TestGate::pinning(Some(&browser.fingerprint));
        let (answer, peer) =
            accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
        browser.take_answer(&answer);
        let (opened, replies) = browser.run(ASK, Duration::from_secs(10));
        assert!(opened);
        assert_eq!(replies.len(), 1);

        let stopping = std::thread::spawn(move || peer.stop(reason));
        let (_opened, frames) = browser.run_asks(&[], 1, Duration::from_secs(10));
        assert!(
            browser.rtc.is_alive(),
            "the browser was told before it was cut off"
        );
        stopping.join().unwrap();

        let events = joined(&frames);
        let event: serde_json::Value = serde_json::from_str(&events[&0]).unwrap();
        assert_eq!(
            event,
            serde_json::json!({ "event": "farewell", "reason": named })
        );
        assert_eq!(gate.disconnected.load(Ordering::SeqCst), 1);
    }
}

/// Scenario: the phone stops a connection whose browser is no longer reading.
/// Expected behaviour: the stop still returns and the connection is counted
/// as ended, whether or not the farewell was read.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_stop_does_not_wait_for_a_browser_that_never_reads_the_farewell() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) =
        accept(&offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);
    let (opened, _) = browser.run(ASK, Duration::from_secs(10));
    assert!(opened);

    peer.stop(DisconnectReason::Background);
    assert_eq!(gate.disconnected.load(Ordering::SeqCst), 1);
}

/// A connection that never came up has no channel to say anything on, and
/// stops without waiting on one.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_stop_before_any_channel_opens_ends_without_a_farewell() {
    let (mut browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let (answer, peer) = accept(&offer, certificate(), loopback(), gate, None).expect("accepted");
    browser.take_answer(&answer);
    peer.stop(DisconnectReason::Removed);
}

/// Scenario: a client offers with no candidates and never sends a check.
/// Expected behaviour: the peer ends once the setup deadline passes.
#[test]
fn an_offer_that_never_connects_ends_at_the_setup_deadline() {
    let (_browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&_browser.fingerprint));
    let (_answer, peer) = accept_polling(
        &offer,
        certificate(),
        loopback(),
        gate,
        None,
        Duration::from_secs(3600),
        Duration::from_millis(300),
    )
    .expect("accepted");
    assert!(peer.is_pending());
    let until = Instant::now() + Duration::from_secs(5);
    while !peer.is_finished() && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(peer.is_finished());
}

#[test]
fn an_unpinned_offer_is_refused_before_any_network_or_disk_work() {
    let (_browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some("sha-256 00:11"));
    let prepared = AtomicUsize::new(0);
    let refused = crate::remote::service::accept_offer_with(&offer, gate, || {
        prepared.fetch_add(1, Ordering::Relaxed);
        Err(Refusal::Network("not reached".into()))
    });
    assert_eq!(refused.err(), Some(Refusal::NotPinned));
    assert_eq!(prepared.load(Ordering::Relaxed), 0);
}

#[test]
fn a_pinned_offer_runs_the_preparation_once() {
    let (browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some(&browser.fingerprint));
    let prepared = AtomicUsize::new(0);
    let refused = crate::remote::service::accept_offer_with(&offer, gate, || {
        prepared.fetch_add(1, Ordering::Relaxed);
        Err(Refusal::Network("stop here".into()))
    });
    assert_eq!(refused.err(), Some(Refusal::Network("stop here".into())));
    assert_eq!(prepared.load(Ordering::Relaxed), 1);
}
