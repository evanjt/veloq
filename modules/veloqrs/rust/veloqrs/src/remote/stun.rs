//! Learning the phone's public address with one STUN binding request.
//!
//! A STUN server learns only the public address a packet came from. The
//! data the two devices exchange never goes through it: it stays encrypted
//! end to end between the browser and the phone. The browser page names the
//! same server in `docs/connect/link.js`.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::threads;

/// The server both ends ask for their public address.
pub const SERVER: &str = "stun.cloudflare.com:3478";

/// How long the phone waits for the server's name to resolve.
pub const RESOLVE_WAIT: Duration = Duration::from_millis(1000);

/// How long the phone waits for the server's reply.
pub const REPLY_WAIT: Duration = Duration::from_millis(1500);

const MAGIC: u32 = 0x2112_A442;
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const MAPPED_ADDRESS: u16 = 0x0001;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;
const HEADER: usize = 20;

/// A server to ask and how long to wait for it.
#[derive(Debug, Clone, Copy)]
pub struct Stun {
    pub server: SocketAddr,
    pub wait: Duration,
}

impl Stun {
    /// The default server, resolved within [`RESOLVE_WAIT`] to an address of
    /// the family the socket is bound in. None when it does not resolve.
    pub fn resolve_default(ipv6: bool) -> Option<Self> {
        let server = resolve(SERVER, ipv6, RESOLVE_WAIT)?;
        Some(Self {
            server,
            wait: REPLY_WAIT,
        })
    }
}

/// Resolve `name` on a worker thread, so a stalled resolver costs at most
/// `wait`.
pub fn resolve(name: &str, ipv6: bool, wait: Duration) -> Option<SocketAddr> {
    let (tx, rx) = mpsc::channel();
    let name = name.to_owned();
    threads::try_spawn_named("stun-resolve", move || {
        let found = name
            .to_socket_addrs()
            .ok()
            .and_then(|mut all| all.find(|address| address.is_ipv6() == ipv6));
        let _ = tx.send(found);
    })
    .ok()?;
    rx.recv_timeout(wait).ok().flatten()
}

fn transaction_id() -> [u8; 12] {
    let mut id = [0u8; 12];
    for chunk in id.chunks_mut(4) {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u8(0);
        chunk.copy_from_slice(&hasher.finish().to_be_bytes()[..4]);
    }
    id
}

fn request(id: &[u8; 12]) -> [u8; HEADER] {
    let mut message = [0u8; HEADER];
    message[0..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    message[4..8].copy_from_slice(&MAGIC.to_be_bytes());
    message[8..].copy_from_slice(id);
    message
}

/// The address a binding success response for transaction `id` reports.
pub fn parse_response(message: &[u8], id: &[u8; 12]) -> Option<SocketAddr> {
    if message.len() < HEADER
        || u16::from_be_bytes([message[0], message[1]]) != BINDING_SUCCESS
        || message[4..8] != MAGIC.to_be_bytes()
        || message[8..HEADER] != id[..]
    {
        return None;
    }
    let length = usize::from(u16::from_be_bytes([message[2], message[3]]));
    let mut body = message.get(HEADER..HEADER + length)?;
    let mut plain = None;
    while body.len() >= 4 {
        let kind = u16::from_be_bytes([body[0], body[1]]);
        let size = usize::from(u16::from_be_bytes([body[2], body[3]]));
        let value = body.get(4..4 + size)?;
        match kind {
            XOR_MAPPED_ADDRESS => return address(value, true, id),
            MAPPED_ADDRESS => plain = address(value, false, id),
            _ => {}
        }
        body = body.get(4 + size.div_ceil(4) * 4..).unwrap_or(&[]);
    }
    plain
}

fn address(value: &[u8], xored: bool, id: &[u8; 12]) -> Option<SocketAddr> {
    let family = *value.get(1)?;
    let mut port = u16::from_be_bytes([*value.get(2)?, *value.get(3)?]);
    let magic = MAGIC.to_be_bytes();
    if xored {
        port ^= u16::from_be_bytes([magic[0], magic[1]]);
    }
    let unmask = |bytes: &mut [u8]| {
        if xored {
            let mut key = magic.to_vec();
            key.extend_from_slice(id);
            for (byte, mask) in bytes.iter_mut().zip(key) {
                *byte ^= mask;
            }
        }
    };
    match family {
        1 => {
            let mut octets: [u8; 4] = value.get(4..8)?.try_into().ok()?;
            unmask(&mut octets);
            Some(SocketAddr::new(octets.into(), port))
        }
        2 => {
            let mut octets: [u8; 16] = value.get(4..20)?.try_into().ok()?;
            unmask(&mut octets);
            Some(SocketAddr::new(octets.into(), port))
        }
        _ => None,
    }
}

/// Ask `stun.server` from `socket` which public address the socket's packets
/// arrive from. None on a refusal, a silent server or no network, once
/// `stun.wait` has passed. The socket's read timeout is left changed.
pub fn mapped_address(socket: &UdpSocket, stun: Stun) -> Option<SocketAddr> {
    let id = transaction_id();
    socket.send_to(&request(&id), stun.server).ok()?;
    let deadline = Instant::now() + stun.wait;
    let mut buf = [0u8; 576];
    loop {
        let left = deadline.checked_duration_since(Instant::now())?;
        if left.is_zero() {
            return None;
        }
        socket.set_read_timeout(Some(left)).ok()?;
        match socket.recv_from(&mut buf) {
            Ok((n, source)) if source == stun.server => {
                if let Some(found) = parse_response(&buf[..n], &id) {
                    return Some(found);
                }
            }
            Ok(_) => {}
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
#[path = "tests/stun.rs"]
mod tests;
