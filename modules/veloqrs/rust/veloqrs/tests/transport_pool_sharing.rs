//! Scenario: every spawned job built its own `Transport`, and each one built a
//! fresh `reqwest::Client` with a pool of its own. The pool settings then did
//! nothing across jobs, because the pool was dropped with the transport, so
//! every on-demand fetch paid a TCP connect and a TLS handshake before the
//! request the screen was waiting on.
//!
//! Expected behaviour: transports built the same way share one client, so the
//! second one reuses the connection the first opened.
//!
//! A counting listener rather than a mock server: what is being asserted is how
//! many times the connection was made, which no request assertion can see.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use veloqrs::governor::AuthMethod;
use veloqrs::governor::Lane;
use veloqrs::net::transport::Transport;

/// Answers `{}` to every request on a connection and keeps it open, which is
/// what lets a pooled client reuse it.
fn serve(stream: TcpStream) {
    let mut writer = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);
    loop {
        let mut saw_request = false;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => return,
                Ok(_) => {}
            }
            if line == "\r\n" {
                break;
            }
            saw_request = true;
        }
        if !saw_request {
            return;
        }
        let body = b"{}";
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
            body.len()
        );
        if writer.write_all(head.as_bytes()).is_err() || writer.write_all(body).is_err() {
            return;
        }
        let _ = writer.flush();
    }
}

fn start_server() -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let connections = Arc::new(AtomicUsize::new(0));
    let counter = connections.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            counter.fetch_add(1, Ordering::SeqCst);
            thread::spawn(move || serve(stream));
        }
    });
    (base, connections)
}

fn get(transport: &Transport) {
    let got: serde_json::Value =
        veloqrs::runtime::block_on(transport.get_json("/athlete/0", &[], Lane::Interactive))
            .expect("request");
    assert_eq!(got, serde_json::json!({}));
}

#[test]
fn two_transports_built_the_same_way_reuse_one_connection() {
    let (base, connections) = start_server();

    let first = Transport::new(base.clone(), AuthMethod::ApiKey("secret")).expect("first");
    get(&first);
    assert_eq!(
        connections.load(Ordering::SeqCst),
        1,
        "the first request opens the connection"
    );

    let second = Transport::new(base, AuthMethod::ApiKey("secret")).expect("second");
    get(&second);
    assert_eq!(
        connections.load(Ordering::SeqCst),
        1,
        "a second transport must reuse it, not open another"
    );
}

/// The credential belongs to the transport, not to the pool, so two athletes'
/// transports still share the connection to the same host.
#[test]
fn a_different_credential_still_shares_the_connection() {
    let (base, connections) = start_server();

    let first = Transport::new(base.clone(), AuthMethod::ApiKey("one")).expect("first");
    get(&first);
    let second = Transport::new(base, AuthMethod::Bearer("two")).expect("second");
    get(&second);

    assert_eq!(connections.load(Ordering::SeqCst), 1);
}
