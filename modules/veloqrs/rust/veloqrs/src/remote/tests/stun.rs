//! A fake STUN server on loopback answers binding requests.

use super::*;
use crate::remote::peer::{Gate, accept};
use std::sync::Arc;
use std::thread;

const MAPPED: &str = "203.0.113.9:40123";

struct OpenGate;

impl Gate for OpenGate {
    fn is_pinned(&self, _fingerprint: &str) -> bool {
        true
    }
    fn answer(&self, _presented: &str, _local: &str, _request: &str) -> String {
        String::new()
    }
    fn connected(&self, _fingerprint: &str) {}
    fn disconnected(&self, _fingerprint: &str) {}
    fn changed(&self) -> Option<u64> {
        None
    }
}

fn success(request: &[u8], mapped: SocketAddr) -> Vec<u8> {
    let SocketAddr::V4(v4) = mapped else {
        panic!("test uses IPv4")
    };
    let magic = MAGIC.to_be_bytes();
    let mut value = vec![0, 1];
    value.extend_from_slice(&(v4.port() ^ u16::from_be_bytes([magic[0], magic[1]])).to_be_bytes());
    for (octet, mask) in v4.ip().octets().iter().zip(magic) {
        value.push(octet ^ mask);
    }
    let mut message = Vec::new();
    message.extend_from_slice(&BINDING_SUCCESS.to_be_bytes());
    message.extend_from_slice(&u16::try_from(4 + value.len()).unwrap().to_be_bytes());
    message.extend_from_slice(&request[4..HEADER]);
    message.extend_from_slice(&XOR_MAPPED_ADDRESS.to_be_bytes());
    message.extend_from_slice(&u16::try_from(value.len()).unwrap().to_be_bytes());
    message.extend_from_slice(&value);
    message
}

/// A server that answers one request with `mapped`, or stays silent.
fn server(mapped: Option<SocketAddr>) -> (SocketAddr, thread::JoinHandle<()>) {
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let address = socket.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let mut buf = [0u8; 64];
        if let Ok((n, source)) = socket.recv_from(&mut buf)
            && let Some(mapped) = mapped
        {
            let _ = socket.send_to(&success(&buf[..n], mapped), source);
        }
    });
    (address, handle)
}

fn browser_offer() -> String {
    crate::remote::install_crypto();
    let cert = str0m::crypto::from_feature_flags()
        .dtls_provider
        .generate_certificate()
        .unwrap();
    let mut rtc = str0m::RtcConfig::new()
        .set_dtls_cert(cert)
        .build(Instant::now());
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    rtc.add_local_candidate(str0m::Candidate::host(socket.local_addr().unwrap(), "udp").unwrap());
    let mut change = rtc.sdp_api();
    change.add_channel("library".into());
    let (offer, _pending) = change.apply().expect("an offer");
    serde_json::to_string(&offer).unwrap()
}

fn answer_with(stun: Option<Stun>) -> String {
    let cert = str0m::crypto::from_feature_flags()
        .dtls_provider
        .generate_certificate()
        .unwrap();
    let (answer, peer) = accept(
        &browser_offer(),
        cert,
        "127.0.0.1".parse().unwrap(),
        Arc::new(OpenGate),
        stun,
    )
    .expect("accepted");
    peer.stop(crate::remote::DisconnectReason::Disconnected);
    answer
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_answer_offers_the_address_the_server_reports() {
    let mapped: SocketAddr = MAPPED.parse().unwrap();
    let (server, handle) = server(Some(mapped));
    let answer = answer_with(Some(Stun {
        server,
        wait: Duration::from_secs(5),
    }));
    handle.join().unwrap();
    assert!(
        answer.contains("203.0.113.9 40123 typ srflx"),
        "no reflexive candidate: {answer}"
    );
    assert!(answer.contains("typ host"), "host candidate missing");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_silent_server_leaves_the_host_candidate_alone() {
    let (server, handle) = server(None);
    let answer = answer_with(Some(Stun {
        server,
        wait: Duration::from_millis(100),
    }));
    handle.join().unwrap_or(());
    assert!(answer.contains("typ host"));
    assert!(!answer.contains("typ srflx"), "{answer}");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn no_server_answers_with_the_host_candidate_alone() {
    let answer = answer_with(None);
    assert!(answer.contains("typ host"));
    assert!(!answer.contains("typ srflx"));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_reply_for_another_transaction_is_ignored() {
    let id = [7u8; 12];
    let other = [8u8; 12];
    let mapped: SocketAddr = MAPPED.parse().unwrap();
    assert_eq!(
        parse_response(&success(&request(&other), mapped), &id),
        None
    );
    assert_eq!(
        parse_response(&success(&request(&id), mapped), &id),
        Some(mapped)
    );
    assert_eq!(parse_response(&[0u8; 8], &id), None);
}
