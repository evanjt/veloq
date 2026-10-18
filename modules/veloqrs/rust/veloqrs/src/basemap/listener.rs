//! The loopback listener the Android map page fetches basemap tiles from.
//!
//! The WebView's request interceptor is synchronous, and so is the body it
//! hands back: a miss either holds an interceptor thread for its whole fetch or
//! answers a body whose `read()` blocks, and Chromium runs both on one small
//! pool that also delivers the tiles already in hand. Over a socket a miss is a
//! task on the engine's runtime waiting on the tile host, and holds no thread
//! of the WebView's or of ours.
//!
//! Three things keep it the page's alone and quick:
//!
//! - It binds 127.0.0.1 only, and every path starts with a random token drawn
//!   once per process. A request without it is answered 404 before the store
//!   is touched, so another app on the device cannot read the store through it.
//! - It listens on [`SHARDS`] ports. Chromium opens at most six HTTP/1.1
//!   connections per host and port, so one port put a pan's two dozen misses on
//!   the wire six at a time. MapLibre spreads a source's `tiles` by
//!   `(x + y) % n`, so one URL per port spreads them over every shard.
//! - CORS names the page's origin, which is a different origin from loopback.
//!
//! A frozen process can lose its sockets, so [`address`] probes its own ports
//! and binds again, on the same ports where it can, so a page already holding
//! the URLs keeps working.

use futures::FutureExt;
use std::future::Future;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::pin::Pin;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::JoinHandle;

use super::{NO_TILE, TileLookup, UPSTREAM_FAILED};

/// Ports the listener answers on. Four measured as removing the six-wide
/// connection queue on a handset's WebView for a 24-tile pan.
pub const SHARDS: usize = 4;

/// The origin every Android map page loads on, and the only one CORS admits.
pub const PAGE_ORIGIN: &str = "https://veloq.fit";

/// The longest request head read before the connection is dropped. A tile
/// request is one line and a handful of headers.
const MAX_HEAD: usize = 16 * 1024;

/// How long an idle connection is kept before it is closed. Chromium reuses a
/// connection across a pan and drops its own idle ones sooner than this.
const IDLE: Duration = Duration::from_secs(60);

/// How long a probe of one of our own ports may take before it counts as dead.
const PROBE_TIMEOUT: Duration = Duration::from_millis(250);

/// How often [`address`] may probe. A style build asks once per source, and
/// the sockets do not die between two of those.
const PROBE_INTERVAL: Duration = Duration::from_secs(2);

/// How long a re-bind waits for the old sockets to close before taking new
/// ports.
const REBIND_WAIT: Duration = Duration::from_millis(200);

/// What the listener answers one tile with.
pub enum TileAnswer {
    /// The bytes are in hand.
    Ready(Vec<u8>),
    /// There is no tile, and this is the status the page is answered with.
    Refused(u16),
    /// The host is being asked; the bytes or the status follow.
    Pending(Pin<Box<dyn Future<Output = Result<Vec<u8>, u16>> + Send>>),
}

/// The listener's side of the store: one tile's answer, called off the runtime
/// workers because a hit reads the disk.
pub type Answerer = Arc<dyn Fn(&str, u8, u32, u32) -> TileAnswer + Send + Sync>;

/// The ports and the token a page builds its tile URLs from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenerAddress {
    pub ports: Vec<u16>,
    pub token: String,
}

/// One running listener: its accept loops, one per port.
pub struct TileListener {
    token: String,
    ports: Vec<u16>,
    accepts: Vec<JoinHandle<()>>,
    answer: Answerer,
}

impl TileListener {
    /// Bind [`SHARDS`] ports on loopback and start answering on each.
    pub fn bind(token: String, answer: Answerer) -> std::io::Result<Self> {
        Self::bind_on(token, answer, &[0; SHARDS])
    }

    /// Bind one listener per entry of `ports`, each on that port where it is
    /// free and on any port where it is not, or is zero.
    fn bind_on(token: String, answer: Answerer, ports: &[u16]) -> std::io::Result<Self> {
        let _runtime = crate::runtime::ASYNC_RUNTIME.enter();
        // Built as it goes, so a port that will not bind drops this and stops
        // the loops already started on the others.
        let mut listener = Self {
            token,
            ports: Vec::with_capacity(ports.len()),
            accepts: Vec::with_capacity(ports.len()),
            answer,
        };
        for &wanted in ports {
            let socket = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, wanted))
                .or_else(|_| std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)))?;
            socket.set_nonblocking(true)?;
            listener.ports.push(socket.local_addr()?.port());
            let socket = tokio::net::TcpListener::from_std(socket)?;
            listener.accepts.push(crate::runtime::spawn(accept_loop(
                socket,
                listener.token.clone(),
                Arc::clone(&listener.answer),
            )));
        }
        Ok(listener)
    }

    pub fn address(&self) -> ListenerAddress {
        ListenerAddress {
            ports: self.ports.clone(),
            token: self.token.clone(),
        }
    }

    /// Whether every port still accepts a connection.
    fn answers(&self) -> bool {
        self.accepts.iter().all(|accept| !accept.is_finished())
            && self.ports.iter().all(|&port| {
                let at = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
                TcpStream::connect_timeout(&at, PROBE_TIMEOUT).is_ok()
            })
    }

    /// Stop answering and bind again with the same token, on the same ports
    /// where they are still free.
    fn rebind(self) -> std::io::Result<Self> {
        for accept in &self.accepts {
            accept.abort();
        }
        // An aborted loop drops its socket on the runtime, and the port is
        // free only once it has. A port still taken after the wait falls back
        // to a new one rather than holding the caller.
        let until = Instant::now() + REBIND_WAIT;
        while !self.accepts.iter().all(JoinHandle::is_finished) && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(2));
        }
        Self::bind_on(self.token.clone(), Arc::clone(&self.answer), &self.ports)
    }
}

impl Drop for TileListener {
    fn drop(&mut self) {
        for accept in &self.accepts {
            accept.abort();
        }
    }
}

/// The process's listener and when it was last probed.
static LISTENER: LazyLock<Mutex<Option<(TileListener, Instant)>>> =
    LazyLock::new(|| Mutex::new(None));

/// The listener's ports and token, binding it on the first call and binding
/// again when a probe finds a port that no longer answers.
pub fn address() -> Result<ListenerAddress, String> {
    let mut guard = LISTENER.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    let listener = match guard.take() {
        None => TileListener::bind(new_token()?, Arc::new(store_answer))
            .map_err(|e| format!("could not bind the tile listener: {e}"))?,
        Some((listener, probed)) if now.duration_since(probed) < PROBE_INTERVAL => listener,
        Some((listener, _)) if listener.answers() => listener,
        Some((listener, _)) => {
            log::warn!("[basemap] tile listener stopped answering, binding again");
            listener
                .rebind()
                .map_err(|e| format!("could not bind the tile listener again: {e}"))?
        }
    };
    let address = listener.address();
    *guard = Some((listener, now));
    Ok(address)
}

/// A token nobody outside the process can guess: 128 bits from the kernel.
fn new_token() -> Result<String, String> {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut random| random.read_exact(&mut bytes))
        .map_err(|e| format!("no randomness for the tile listener token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// The store's answer, the same one the interceptor and the scheme handler get.
fn store_answer(source: &str, z: u8, x: u32, y: u32) -> TileAnswer {
    match super::lookup_tile(source, z, x, y) {
        TileLookup::Ready(bytes) => TileAnswer::Ready(bytes),
        TileLookup::Refused(status) => TileAnswer::Refused(status),
        TileLookup::Miss(miss) => TileAnswer::Pending(Box::pin(miss.fetch())),
    }
}

async fn accept_loop(socket: tokio::net::TcpListener, token: String, answer: Answerer) {
    let token: Arc<str> = token.into();
    loop {
        match socket.accept().await {
            Ok((stream, _)) => {
                let _ = stream.set_nodelay(true);
                tokio::spawn(serve_connection(
                    stream,
                    Arc::clone(&token),
                    Arc::clone(&answer),
                ));
            }
            Err(e) => {
                // Out of descriptors, most likely. Waiting lets connections
                // close rather than spinning on the same refusal.
                log::warn!("[basemap] tile listener could not accept: {}", e);
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
}

/// Answer requests on one connection until the page closes it, asks for it to
/// be closed, or leaves it idle.
async fn serve_connection(mut stream: tokio::net::TcpStream, token: Arc<str>, answer: Answerer) {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        let head_end = loop {
            if let Some(at) = find_head_end(&buffer) {
                break at;
            }
            if buffer.len() > MAX_HEAD {
                return;
            }
            match tokio::time::timeout(IDLE, stream.read(&mut chunk)).await {
                Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return,
                Ok(Ok(n)) => buffer.extend_from_slice(&chunk[..n]),
            }
        };
        let head: Vec<u8> = buffer.drain(..head_end).collect();
        let request = Request::parse(&head);
        let close = request.as_ref().is_none_or(|r| r.close);
        let response = match request {
            Some(request) => respond(&request, &token, &answer).await,
            None => Response::empty(400),
        };
        if stream.write_all(&response.encode(close)).await.is_err() {
            return;
        }
        if close {
            let _ = stream.shutdown().await;
            return;
        }
    }
}

fn find_head_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|at| at + 4)
}

/// The parts of a request head the listener reads.
#[derive(Debug, PartialEq, Eq)]
struct Request {
    method: String,
    path: String,
    /// The page asked for the connection to end, or spoke HTTP/1.0, or sent a
    /// body this listener does not read.
    close: bool,
}

impl Request {
    fn parse(head: &[u8]) -> Option<Self> {
        let head = std::str::from_utf8(head).ok()?;
        let mut lines = head.split("\r\n");
        let mut start = lines.next()?.split(' ');
        let (method, path, version) = (start.next()?, start.next()?, start.next()?);
        if start.next().is_some() || !version.starts_with("HTTP/1.") {
            return None;
        }
        let mut close = version == "HTTP/1.0";
        for line in lines {
            let Some((name, value)) = line.split_once(':') else {
                continue;
            };
            let (name, value) = (name.trim(), value.trim());
            if name.eq_ignore_ascii_case("connection") && value.eq_ignore_ascii_case("close") {
                close = true;
            }
            let has_body = (name.eq_ignore_ascii_case("content-length") && value != "0")
                || name.eq_ignore_ascii_case("transfer-encoding");
            if has_body {
                close = true;
            }
        }
        Some(Self {
            method: method.to_string(),
            path: path.to_string(),
            close,
        })
    }
}

/// One tile path, `/<token>/<source>/<z>/<x>/<y>.<ext>`, after the token.
#[derive(Debug, PartialEq, Eq)]
struct TilePath<'a> {
    source: &'a str,
    z: u8,
    x: u32,
    y: u32,
    extension: &'a str,
}

/// Split a request path into its tile, or `Err` with the status it is
/// answered with: 404 for a wrong or missing token, 400 for a path that is
/// not a tile.
fn tile_path<'a>(path: &'a str, token: &str) -> Result<TilePath<'a>, u16> {
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let rest = path.strip_prefix('/').ok_or(NO_TILE)?;
    let (given, rest) = rest.split_once('/').ok_or(NO_TILE)?;
    if !same_token(given, token) {
        return Err(NO_TILE);
    }
    let parts: Vec<&str> = rest.split('/').collect();
    let [source, z, x, file] = parts.as_slice() else {
        return Err(400);
    };
    let (y, extension) = file.split_once('.').unwrap_or((file, ""));
    let parse =
        || -> Option<(u8, u32, u32)> { Some((z.parse().ok()?, x.parse().ok()?, y.parse().ok()?)) };
    let (z, x, y) = parse().ok_or(400u16)?;
    if source.is_empty() {
        return Err(400);
    }
    Ok(TilePath {
        source,
        z,
        x,
        y,
        extension,
    })
}

/// Compare the token without stopping at the first byte that differs.
fn same_token(given: &str, token: &str) -> bool {
    given.len() == token.len()
        && given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |differ, (a, b)| differ | (a ^ b))
            == 0
}

async fn respond(request: &Request, token: &str, answer: &Answerer) -> Response {
    let tile = match tile_path(&request.path, token) {
        Ok(tile) => tile,
        Err(status) => return Response::empty(status),
    };
    match request.method.as_str() {
        "GET" => {}
        // The page's fetches are simple requests and send none, but a
        // preflight answered is cheaper than a tile that never loads.
        "OPTIONS" => return Response::empty(204),
        _ => return Response::empty(405),
    }

    let mime = mime_for(tile.extension);
    let (source, z, x, y) = (tile.source.to_string(), tile.z, tile.x, tile.y);
    let answer = Arc::clone(answer);
    // A hit reads the disk, and the first read of a source loads its sidecar,
    // so the lookup runs on the blocking pool rather than on a worker that
    // the misses' fetches are waiting on.
    let looked_up = tokio::task::spawn_blocking(move || answer(&source, z, x, y)).await;
    let result = match looked_up {
        Ok(TileAnswer::Ready(bytes)) => Ok(bytes),
        Ok(TileAnswer::Refused(status)) => Err(status),
        Ok(TileAnswer::Pending(fetch)) => std::panic::AssertUnwindSafe(fetch)
            .catch_unwind()
            .await
            .unwrap_or(Err(UPSTREAM_FAILED)),
        Err(_) => Err(UPSTREAM_FAILED),
    };
    match result {
        Ok(bytes) if !bytes.is_empty() => Response {
            status: 200,
            mime,
            body: bytes,
        },
        Ok(_) => Response::empty(NO_TILE),
        Err(status) => Response::empty(status),
    }
}

struct Response {
    status: u16,
    mime: &'static str,
    body: Vec<u8>,
}

impl Response {
    fn empty(status: u16) -> Self {
        Self {
            status,
            mime: "application/octet-stream",
            body: Vec::new(),
        }
    }

    fn encode(&self, close: bool) -> Vec<u8> {
        let head = format!(
            "HTTP/1.1 {} {}\r\n\
             Content-Type: {}\r\n\
             Content-Length: {}\r\n\
             Access-Control-Allow-Origin: {}\r\n\
             Access-Control-Allow-Methods: GET\r\n\
             Cache-Control: no-store\r\n\
             Connection: {}\r\n\r\n",
            self.status,
            reason_for(self.status),
            self.mime,
            self.body.len(),
            PAGE_ORIGIN,
            if close { "close" } else { "keep-alive" },
        );
        let mut out = Vec::with_capacity(head.len() + self.body.len());
        out.extend_from_slice(head.as_bytes());
        out.extend_from_slice(&self.body);
        out
    }
}

/// What the bytes are, from the extension the page asked for, as the
/// interceptor types them: never from the source name, and imagery when the
/// template named no extension.
fn mime_for(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "pbf" | "mvt" => "application/x-protobuf",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

fn reason_for(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Tile Path",
        404 => "No Tile",
        405 => "Method Not Allowed",
        429 => "Too Many Requests",
        503 => "Service Unavailable",
        _ => "Bad Gateway",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::watch;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    const HIT: &[u8] = b"held tile";
    const FETCHED: &[u8] = b"fetched tile";

    /// A store whose misses all wait on one latch, counting the lookups and
    /// the fetches that have started.
    struct LatchedStore {
        lookups: AtomicUsize,
        fetching: AtomicUsize,
        release: watch::Sender<bool>,
    }

    impl LatchedStore {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                lookups: AtomicUsize::new(0),
                fetching: AtomicUsize::new(0),
                release: watch::channel(false).0,
            })
        }

        fn answerer(self: &Arc<Self>) -> Answerer {
            let store = Arc::clone(self);
            Arc::new(move |source, _z, _x, _y| {
                store.lookups.fetch_add(1, Ordering::SeqCst);
                match source {
                    "held" => TileAnswer::Ready(HIT.to_vec()),
                    "limited" => TileAnswer::Refused(429),
                    _ => {
                        let store = Arc::clone(&store);
                        let mut released = store.release.subscribe();
                        TileAnswer::Pending(Box::pin(async move {
                            store.fetching.fetch_add(1, Ordering::SeqCst);
                            while !*released.borrow_and_update() {
                                if released.changed().await.is_err() {
                                    return Err(UPSTREAM_FAILED);
                                }
                            }
                            Ok(FETCHED.to_vec())
                        }))
                    }
                }
            })
        }

        /// Wait until `n` fetches have started, or give up after `limit`.
        fn wait_for_fetching(&self, n: usize, limit: Duration) -> usize {
            let until = Instant::now() + limit;
            while self.fetching.load(Ordering::SeqCst) < n && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(5));
            }
            self.fetching.load(Ordering::SeqCst)
        }
    }

    /// One request on its own connection: the status and the body.
    fn get(port: u16, path: &str) -> (u16, Vec<u8>, String) {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {PAGE_ORIGIN}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).expect("a response");
        parse_response(&response)
    }

    fn parse_response(response: &[u8]) -> (u16, Vec<u8>, String) {
        let end = find_head_end(response).expect("a response head");
        let head = String::from_utf8_lossy(&response[..end]).to_string();
        let status = head[9..12].parse().expect("a status");
        (status, response[end..].to_vec(), head)
    }

    fn tile(source: &str, x: u32) -> String {
        format!("/{TOKEN}/{source}/14/{x}/5000.pbf")
    }

    #[test]
    fn a_pan_of_misses_reaches_the_host_together_over_the_shards() {
        let store = LatchedStore::new();
        let listener = TileListener::bind(TOKEN.to_string(), store.answerer()).expect("bind");
        let ports = listener.address().ports;
        assert_eq!(ports.len(), SHARDS);

        // One connection each, spread as MapLibre spreads a source's tiles.
        let pan: Vec<_> = (0..24u32)
            .map(|i| {
                let port = ports[i as usize % ports.len()];
                std::thread::spawn(move || get(port, &tile("openmaptiles", 8000 + i)))
            })
            .collect();

        let started = store.wait_for_fetching(24, Duration::from_secs(10));
        assert_eq!(
            started, 24,
            "a miss waited on another before reaching the host"
        );

        // A hit is answered while every miss is still waiting on its host.
        let (status, body, _) = get(ports[0], &tile("held", 1));
        assert_eq!((status, body.as_slice()), (200, HIT));

        store.release.send_replace(true);
        for request in pan {
            let (status, body, head) = request.join().unwrap();
            assert_eq!((status, body.as_slice()), (200, FETCHED));
            assert!(head.contains("Content-Type: application/x-protobuf"));
        }
    }

    #[test]
    fn a_request_without_the_token_is_refused_before_the_store_is_asked() {
        let store = LatchedStore::new();
        let listener = TileListener::bind(TOKEN.to_string(), store.answerer()).expect("bind");
        let port = listener.address().ports[0];

        for path in [
            "/openmaptiles/14/8000/5000.pbf".to_string(),
            format!("/{}/held/14/1/1.pbf", "f".repeat(TOKEN.len())),
            format!("/{}x/held/14/1/1.pbf", TOKEN),
            "/".to_string(),
        ] {
            let (status, body, _) = get(port, &path);
            assert_eq!(status, 404, "{path}");
            assert!(body.is_empty());
        }
        assert_eq!(store.lookups.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_refusal_crosses_as_its_own_status_with_cors_for_the_page() {
        let store = LatchedStore::new();
        let listener = TileListener::bind(TOKEN.to_string(), store.answerer()).expect("bind");
        let port = listener.address().ports[1];

        let (status, body, head) = get(port, &tile("limited", 1));
        assert_eq!(status, 429);
        assert!(body.is_empty());
        assert!(head.contains(&format!("Access-Control-Allow-Origin: {PAGE_ORIGIN}\r\n")));

        let (status, _, _) = get(port, &format!("/{TOKEN}/held/14/1"));
        assert_eq!(status, 400);
    }

    /// Chromium keeps a connection open across a pan, so a second tile on the
    /// same connection must be answered rather than left waiting.
    #[test]
    fn one_connection_answers_one_request_after_another() {
        let store = LatchedStore::new();
        let listener = TileListener::bind(TOKEN.to_string(), store.answerer()).expect("bind");
        let port = listener.address().ports[2];

        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        for x in 0..3 {
            write!(
                stream,
                "GET {} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
                tile("held", x)
            )
            .unwrap();
            let mut response = Vec::new();
            let mut chunk = [0u8; 512];
            while find_head_end(&response).is_none_or(|end| response.len() < end + HIT.len()) {
                let n = stream
                    .read(&mut chunk)
                    .expect("a response on the same connection");
                assert!(n > 0, "the connection closed after {x} answers");
                response.extend_from_slice(&chunk[..n]);
            }
            let (status, body, head) = parse_response(&response);
            assert_eq!((status, body.as_slice()), (200, HIT));
            assert!(head.contains("Connection: keep-alive"));
        }
    }

    /// A port that stops answering is bound again on the same port, so a page
    /// already holding the URLs keeps loading tiles.
    #[test]
    fn a_listener_that_stopped_answering_binds_again_on_its_ports() {
        let store = LatchedStore::new();
        let listener = TileListener::bind(TOKEN.to_string(), store.answerer()).expect("bind");
        let before = listener.address();
        listener.accepts[0].abort();
        let until = Instant::now() + Duration::from_secs(5);
        while !listener.accepts[0].is_finished() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!listener.answers());

        let listener = listener.rebind().expect("rebind");
        assert!(listener.answers());
        let after = listener.address();
        assert_eq!(after, before);
        let (status, body, _) = get(after.ports[0], &tile("held", 1));
        assert_eq!((status, body.as_slice()), (200, HIT));
    }

    #[test]
    fn a_tile_path_reads_its_source_coordinates_and_extension() {
        assert_eq!(
            tile_path(&format!("/{TOKEN}/satellite-eox/9/268/180.jpg?v=2"), TOKEN),
            Ok(TilePath {
                source: "satellite-eox",
                z: 9,
                x: 268,
                y: 180,
                extension: "jpg",
            })
        );
        assert_eq!(tile_path(&format!("/{TOKEN}/s/z/1/1.png"), TOKEN), Err(400));
        assert_eq!(
            tile_path(&format!("/{TOKEN}/s/300/1/1.png"), TOKEN),
            Err(400)
        );
        assert_eq!(tile_path("/s/1/1/1.png", TOKEN), Err(404));
    }

    #[test]
    fn a_token_is_drawn_fresh_and_long_enough_not_to_be_guessed() {
        let (a, b) = (new_token().unwrap(), new_token().unwrap());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }
}
