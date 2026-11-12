//! A browser stand-in offers over loopback UDP and asks over the data channel.

use super::super::protocol::{
    FRAME_BYTES, FRAME_GZIP, FRAME_HEADER_BYTES, FRAME_LAST, FRAME_VERSION,
};
use super::*;
use std::sync::Mutex;
use std::sync::atomic::AtomicUsize;

use str0m::change::SdpPendingOffer;

const ASK: &str = r#"{"id":1,"method":"feed.page"}"#;

/// Answers every request with a fixed reply, pins a set the test controls,
/// and counts the connections it saw.
struct TestGate {
    pinned: Mutex<Vec<String>>,
    /// Pin checks to answer before every later one is refused, for a device
    /// removed while its connection comes up.
    allow_checks: Option<AtomicUsize>,
    connected: AtomicUsize,
    disconnected: AtomicUsize,
}

impl TestGate {
    fn pinning(fingerprint: Option<&str>) -> Arc<Self> {
        Arc::new(Self {
            pinned: Mutex::new(fingerprint.into_iter().map(String::from).collect()),
            allow_checks: None,
            connected: AtomicUsize::new(0),
            disconnected: AtomicUsize::new(0),
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
    fn connected(&self, _fingerprint: &str) {
        self.connected.fetch_add(1, Ordering::SeqCst);
    }
    fn disconnected(&self, _fingerprint: &str) {
        self.disconnected.fetch_add(1, Ordering::SeqCst);
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
}

impl Browser {
    fn new() -> (Self, String) {
        crate::remote::install_crypto();
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mut rtc = RtcConfig::new()
            .set_dtls_cert(certificate())
            .build(Instant::now());
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
        let mut complete = 0;
        let started = Instant::now();
        let mut opened = false;
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
                    for ask in asks {
                        self.rtc
                            .channel(id)
                            .unwrap()
                            .write(false, ask.as_bytes())
                            .unwrap();
                    }
                }
                Output::Event(Event::ChannelData(data)) => {
                    assert!(data.binary, "a reply left as text");
                    if data.data[1] & FRAME_LAST != 0 {
                        complete += 1;
                    }
                    replies.push(data.data);
                }
                Output::Event(_) => {}
                Output::Timeout(at) => {
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

fn loopback() -> IpAddr {
    "127.0.0.1".parse().unwrap()
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

    peer.stop();
    assert_eq!(gate.disconnected.load(Ordering::SeqCst), 1);
}

#[test]
fn stop_ends_a_read_that_would_otherwise_never_return() {
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let wake = socket.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        let mut buf = [0u8; 16];
        let _ = socket.recv_from(&mut buf);
    });
    Peer {
        stop: Arc::new(AtomicBool::new(false)),
        thread: Some(thread),
        wake,
    }
    .stop();
}

#[test]
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
    )
    .expect("accepted");
    browser.take_answer(&answer);
    let (opened, _) = browser.run(ASK, Duration::from_secs(10));
    assert!(opened);

    peer.stop();
    assert_eq!(gate.disconnected.load(Ordering::SeqCst), 1);
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
    serde_json::json!({ "id": id, "method": "blob", "params": { "size": size, "kind": kind } })
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
    peer.stop();
}

/// Scenario: sixteen asks go out back to back and every reply outgrows the
/// room left by the one before. Expected behaviour: all sixteen arrive.
#[test]
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
    peer.stop();
}

#[test]
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
    peer.stop();
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
    peer.stop();
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
fn an_offered_fingerprint_is_read_in_one_spelling() {
    let sdp = "v=0\r\na=fingerprint:SHA-256 ab:cd:ef\r\n";
    assert_eq!(
        offered_fingerprint(sdp).as_deref(),
        Some("sha-256 AB:CD:EF")
    );
    assert_eq!(offered_fingerprint("v=0\r\n"), None);
}
