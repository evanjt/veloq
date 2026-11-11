//! A browser stand-in offers over loopback UDP and asks over the data channel.

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
        format!("answered {request}")
    }
    fn connected(&self, _fingerprint: &str) {
        self.connected.fetch_add(1, Ordering::SeqCst);
    }
    fn disconnected(&self, _fingerprint: &str) {
        self.disconnected.fetch_add(1, Ordering::SeqCst);
    }
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
    fn run(&mut self, ask: &str, until: Duration) -> (bool, Vec<String>) {
        let started = Instant::now();
        let mut opened = false;
        let mut replies = Vec::new();
        let mut buf = vec![0u8; 2000];
        let local = self.socket.local_addr().unwrap();
        while started.elapsed() < until && self.rtc.is_alive() && replies.is_empty() {
            match self.rtc.poll_output().unwrap() {
                Output::Transmit(out) => {
                    let _ = self.socket.send_to(&out.contents, out.destination);
                }
                Output::Event(Event::ChannelOpen(id, _)) => {
                    opened = true;
                    self.rtc
                        .channel(id)
                        .unwrap()
                        .write(false, ask.as_bytes())
                        .unwrap();
                }
                Output::Event(Event::ChannelData(data)) => {
                    replies.push(String::from_utf8(data.data).unwrap());
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
    let (answer, peer) = accept(&offer, certificate(), loopback(), gate.clone()).expect("accepted");
    browser.take_answer(&answer);

    let (opened, replies) = browser.run(ASK, Duration::from_secs(10));
    assert!(opened);
    assert_eq!(replies, vec![format!("answered {ASK}")]);
    assert_eq!(gate.connected.load(Ordering::SeqCst), 1);

    peer.stop();
    assert_eq!(gate.disconnected.load(Ordering::SeqCst), 1);
}

#[test]
fn an_unpinned_browser_is_refused_before_any_answer() {
    let (_browser, offer) = Browser::new();
    let gate = TestGate::pinning(Some("sha-256 00:11"));
    let refused = accept(&offer, certificate(), loopback(), gate.clone());
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
    let (answer, peer) = accept(&offer, certificate(), loopback(), gate.clone()).expect("accepted");
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
        accept("not json", certificate(), loopback(), gate),
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
