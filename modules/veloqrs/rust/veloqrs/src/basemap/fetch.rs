//! Filling the tile store from third-party tile hosts.
//!
//! Deliberately not the intervals.icu governor. That lane is shaped around one
//! base URL, mandatory auth and intervals.icu's own rate headers, none of which
//! a tile host has. Sharing it would also spend the athlete's intervals.icu
//! budget on imagery, which is not what that budget is for.

use super::TileStore;
use super::encoding;
use futures::{Stream, StreamExt};
use reqwest::header::{ACCEPT_ENCODING, CONTENT_ENCODING};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Identifies the app to tile hosts, most of which ask for it in their terms.
const TILE_USER_AGENT: &str = concat!("veloq/", env!("CARGO_PKG_VERSION"), " (+https://veloq.fit)");

/// One tile request every this often while filling the store. Background work
/// on someone else's servers, so it is paced well under what a map pan asks
/// for interactively.
pub const FILL_PACE: Duration = Duration::from_millis(100);

/// The most a tile or glyph range may hold, on the wire and again once
/// decompressed: a stop for a host that streams without end, or sends a small
/// gzip that inflates to gigabytes.
pub const MAX_TILE_BYTES: usize = 4 * 1024 * 1024;

/// The most a TileJSON document may hold. It names a template, its zoom range
/// and its layers, which is a few KB.
pub const MAX_TILEJSON_BYTES: usize = 256 * 1024;

/// How long a connection to a tile host may sit idle and still carry the next
/// burst. Past this a burst opens a connection of its own. Against the same
/// tile host, a burst on a connection left idle for two minutes, kept open by
/// keep-alive pings, came back slower than the same burst on a connection
/// opened for it with its handshake included, while one idle for 30 s answered
/// as fast as a warm one.
pub const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// The most the rest of a burst waits on its leader, from when the leader was
/// sent. A connect and a TLS handshake take 100 to 300 ms on a mobile network
/// and the request after them one round trip more, so a leader still
/// unanswered past this is a slow host rather than a cold connection, and the
/// rest go on the wire without it.
pub const LEADER_WAIT: Duration = Duration::from_secs(1);

/// A tile request never reached a tile.
#[derive(Debug, thiserror::Error)]
pub enum TileFetchError {
    #[error("tile host unreachable: {0}")]
    Unreachable(String),
    #[error("tile host answered {status}")]
    Rejected { status: u16 },
    #[error("tile host answered with an empty body")]
    Empty,
    #[error("tile host sent more than {cap} bytes")]
    TooLarge { cap: usize },
    #[error("tile host sent a body that does not decode: {0}")]
    Garbled(String),
    #[error("could not store the tile: {0}")]
    Store(String),
}

/// A `reqwest` client of its own, paced by itself.
#[derive(Debug)]
pub struct TileFetcher {
    /// Negotiates the protocol, for a host not yet heard from and for one that
    /// answers over HTTP/1.1.
    client: reqwest::Client,
    /// Speaks only HTTP/2, for a host known to. A burst on its cold pool shares
    /// the one connection the first request opens, where a client negotiating
    /// the protocol would open one per request.
    http2: reqwest::Client,
    pace: Duration,
    /// The earliest a request may start. Reserved under the lock and waited on
    /// outside it, so concurrent callers queue rather than all sleeping to the
    /// same instant and firing together.
    next_slot: Mutex<Option<Instant>>,
    /// What each host's last answer showed, by scheme, host and port.
    hosts: Mutex<HashMap<String, HostAnswer>>,
    /// One per host, held by the request that opens a cold pool's connection.
    leaders: Mutex<HashMap<String, Arc<Leader>>>,
}

/// The request a cold pool's burst waits on, for one host.
#[derive(Debug, Default)]
struct Leader {
    /// Held from when the leader is sent until it is answered or fails.
    turn: tokio::sync::Mutex<()>,
    /// When the current leader was sent.
    sent: Mutex<Option<Instant>>,
}

/// What a host's last answer showed about the connection it came on.
#[derive(Debug, Clone, Copy)]
struct HostAnswer {
    /// Answered over HTTP/1.1, where one connection carries one request at a
    /// time and a burst needs a connection per request whatever goes first.
    http1: bool,
    /// When it answered, on the clock the pool keeps its idle time by.
    at: tokio::time::Instant,
}

/// Whether the connection a host last answered on is still in the pool: it
/// answered inside [`POOL_IDLE_TIMEOUT`]. The pool counts idle time from when
/// the body was read, which is after the answer, so this never says a
/// connection is open once the pool has let it go.
fn still_pooled(last: Option<HostAnswer>, now: tokio::time::Instant) -> bool {
    last.is_some_and(|answer| now.saturating_duration_since(answer.at) < POOL_IDLE_TIMEOUT)
}

/// Whether a request to a host goes alone before the rest of its burst: one
/// request first and the rest once it has answered, or once [`LEADER_WAIT`]
/// has passed.
///
/// Only for a host whose protocol is not known: never answered, or forgotten
/// after a send error. Until a connection has answered the client cannot know
/// the host speaks HTTP/2, so each request of a burst would open its own
/// connection and TLS handshake, and two dozen handshakes contend for the
/// radio where one would have carried them all. A host known to speak HTTP/2
/// goes through the client that shares one connect across a burst, so a
/// request sent alone there only spends a round trip the rest then wait on.
fn leads_burst(last: Option<HostAnswer>) -> bool {
    last.is_none()
}

/// The pool's key for a URL: scheme, host and port.
fn host_key(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(parsed) => format!(
            "{}://{}:{}",
            parsed.scheme(),
            parsed.host_str().unwrap_or_default(),
            parsed.port_or_known_default().unwrap_or_default()
        ),
        Err(_) => url.to_string(),
    }
}

/// The origin of a URL, `scheme://host:port/`, or `None` when it does not
/// parse as one, as a template naming its host by placeholder does not.
fn origin_of(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let origin = parsed.origin();
    origin
        .is_tuple()
        .then(|| format!("{}/", origin.ascii_serialization()))
}

impl TileFetcher {
    pub fn new(pace: Duration) -> Result<Self, String> {
        // gzip is asked for on every request and decompressed here rather than
        // by `reqwest`, so a tile can be kept as the host sent it. `reqwest`
        // would otherwise decompress before anything could see the body, and
        // a client that stopped asking would put half as many bytes again on
        // the wire with nothing counting them.
        let builder = || {
            reqwest::Client::builder()
                .user_agent(TILE_USER_AGENT)
                .timeout(Duration::from_secs(20))
                .no_gzip()
                .pool_idle_timeout(POOL_IDLE_TIMEOUT)
        };
        let client = builder()
            .build()
            .map_err(|e| format!("tile client: {}", e))?;
        let http2 = builder()
            .http2_prior_knowledge()
            .build()
            .map_err(|e| format!("tile client: {}", e))?;
        Ok(Self {
            client,
            http2,
            pace,
            next_slot: Mutex::new(None),
            hosts: Mutex::new(HashMap::new()),
            leaders: Mutex::new(HashMap::new()),
        })
    }

    /// The fetcher background fills use.
    pub fn for_fill() -> Result<Self, String> {
        Self::new(FILL_PACE)
    }

    /// One tile's bytes, decompressed. A non-success status, an unreachable
    /// host and an empty body are all failures: none of them is a tile, and
    /// storing any of them would serve a hole to the map for as long as it
    /// survived eviction.
    pub async fn fetch(&self, url: &str) -> Result<Vec<u8>, TileFetchError> {
        self.fetch_within(url, MAX_TILE_BYTES).await
    }

    /// A TileJSON document's bytes, decompressed, failing as
    /// [`fetch`](Self::fetch) does under the smaller cap a document takes.
    pub async fn fetch_tilejson(&self, url: &str) -> Result<Vec<u8>, TileFetchError> {
        self.fetch_within(url, MAX_TILEJSON_BYTES).await
    }

    /// A body decompressed, failing past `cap` bytes on the wire or once
    /// decompressed.
    async fn fetch_within(&self, url: &str, cap: usize) -> Result<Vec<u8>, TileFetchError> {
        let (sent, gzipped) = self.body(url, cap).await?;
        if !gzipped {
            return Ok(sent);
        }
        match encoding::gunzip_at_most(&sent, cap) {
            Ok(Some(body)) => Ok(body),
            Ok(None) => Err(TileFetchError::TooLarge { cap }),
            Err(e) => Err(TileFetchError::Garbled(e.to_string())),
        }
    }

    /// One tile's body as the host sent it: gzipped when the host gzipped it,
    /// which is how the store keeps it. Fails as [`fetch`](Self::fetch) does,
    /// and also on a body in an encoding never asked for, or labelled gzip and
    /// not a gzip stream, since nothing could decode either once kept.
    pub async fn fetch_as_sent(&self, url: &str) -> Result<Vec<u8>, TileFetchError> {
        self.body(url, MAX_TILE_BYTES).await.map(|(sent, _)| sent)
    }

    /// The body as sent, and whether the host gzipped it. A body past `cap`
    /// bytes fails, before any of it is read when the host declares its length.
    async fn body(&self, url: &str, cap: usize) -> Result<(Vec<u8>, bool), TileFetchError> {
        self.wait_for_slot().await;

        let host = host_key(url);
        if self.leads(&host) {
            let leader = self.leader(&host);
            match leader.turn.try_lock() {
                Ok(lead) => {
                    *leader.sent.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
                    let response = self.send(&host, url).await;
                    drop(lead);
                    return answered_body(response?, cap).await;
                }
                // The rest of the burst waits for the leader to be answered
                // or to fail, and then goes together, or goes without it once
                // the leader has waited past a cold connection. A leader that
                // failed releases them all, so an outage is not met one
                // request at a time.
                Err(_) => {
                    let sent = *leader.sent.lock().unwrap_or_else(|e| e.into_inner());
                    let until = sent.unwrap_or_else(Instant::now) + LEADER_WAIT;
                    let _ = tokio::time::timeout_at(until.into(), leader.turn.lock()).await;
                }
            }
        }
        let response = self.send(&host, url).await?;
        answered_body(response, cap).await
    }

    /// Open a connection to the host a tile template names, ahead of the
    /// burst a pan is about to send, so the burst finds the handshake done.
    ///
    /// Nothing is sent when the host answered inside the pool's idle window,
    /// since its connection is still open. Otherwise one `HEAD` goes to the
    /// template's origin, through the client the next burst would use, which
    /// opens the connection without asking for a tile the pan may not need. On
    /// a host never heard from it takes the leader's turn, so a burst arriving
    /// during the handshake waits on it rather than opening connections of its
    /// own. The answer's status is ignored; a send error forgets the host, as
    /// it does for a tile.
    pub async fn warm(&self, template: &str) {
        let Some(origin) = origin_of(template) else {
            return;
        };
        let host = host_key(&origin);
        if still_pooled(self.answered(&host), tokio::time::Instant::now()) {
            return;
        }
        if !self.leads(&host) {
            let _ = self.send_as(reqwest::Method::HEAD, &host, &origin).await;
            return;
        }
        let leader = self.leader(&host);
        // A leader already on the wire is opening the connection this would.
        let Ok(lead) = leader.turn.try_lock() else {
            return;
        };
        *leader.sent.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
        let _ = self.send_as(reqwest::Method::HEAD, &host, &origin).await;
        drop(lead);
    }

    /// Fetch one tile and store it as the host sent it. Returns the bytes
    /// stored.
    #[allow(clippy::too_many_arguments)]
    pub async fn fetch_into(
        &self,
        store: &TileStore,
        source: &str,
        z: u8,
        x: u32,
        y: u32,
        ext: &str,
        url: &str,
        pinned: bool,
    ) -> Result<u64, TileFetchError> {
        let bytes = self.fetch_as_sent(url).await?;
        store
            .put(source, z, x, y, ext, &bytes, pinned)
            .map_err(|e| TileFetchError::Store(e.to_string()))?;
        Ok(bytes.len() as u64)
    }

    /// Send one request and note what its answer showed about the host. Only
    /// headers are awaited, so a burst waiting on a leader is released before
    /// the leader's body has been read. A request that fails forgets the
    /// host's last answer, since the connection it went on may be closed.
    async fn send(&self, host: &str, url: &str) -> Result<reqwest::Response, TileFetchError> {
        self.send_as(reqwest::Method::GET, host, url).await
    }

    async fn send_as(
        &self,
        method: reqwest::Method,
        host: &str,
        url: &str,
    ) -> Result<reqwest::Response, TileFetchError> {
        let client = match self.answered(host) {
            Some(HostAnswer { http1: false, .. }) => &self.http2,
            _ => &self.client,
        };
        let sent = client
            .request(method, url)
            .header(ACCEPT_ENCODING, "gzip")
            .send()
            .await;
        let mut hosts = self.hosts.lock().unwrap_or_else(|e| e.into_inner());
        match sent {
            Ok(response) => {
                let answer = HostAnswer {
                    http1: response.version() <= reqwest::Version::HTTP_11,
                    at: tokio::time::Instant::now(),
                };
                hosts.insert(host.to_string(), answer);
                Ok(response)
            }
            Err(e) => {
                hosts.remove(host);
                Err(TileFetchError::Unreachable(e.to_string()))
            }
        }
    }

    fn leads(&self, host: &str) -> bool {
        leads_burst(self.answered(host))
    }

    fn answered(&self, host: &str) -> Option<HostAnswer> {
        self.hosts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(host)
            .copied()
    }

    fn leader(&self, host: &str) -> Arc<Leader> {
        Arc::clone(
            self.leaders
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(host.to_string())
                .or_default(),
        )
    }

    async fn wait_for_slot(&self) {
        if self.pace.is_zero() {
            return;
        }
        let wait = {
            let mut next = self.next_slot.lock().unwrap_or_else(|e| e.into_inner());
            let now = Instant::now();
            let slot = match *next {
                Some(at) if at > now => at,
                _ => now,
            };
            *next = Some(slot + self.pace);
            slot.saturating_duration_since(now)
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
}

/// The body of an answered request, as [`TileFetcher::body`] returns it.
async fn answered_body(
    response: reqwest::Response,
    cap: usize,
) -> Result<(Vec<u8>, bool), TileFetchError> {
    let status = response.status();
    if !status.is_success() {
        return Err(TileFetchError::Rejected {
            status: status.as_u16(),
        });
    }

    let gzipped = match response.headers().get(CONTENT_ENCODING) {
        None => false,
        Some(value) => match value.to_str().map(str::trim) {
            Ok(v) if v.eq_ignore_ascii_case("gzip") => true,
            Ok(v) if v.eq_ignore_ascii_case("identity") || v.is_empty() => false,
            _ => {
                return Err(TileFetchError::Garbled(format!(
                    "content-encoding {:?} was never asked for",
                    value
                )));
            }
        },
    };

    if declared_past_cap(response.content_length(), cap) {
        return Err(TileFetchError::TooLarge { cap });
    }
    let bytes = read_capped(response.bytes_stream(), cap).await?;
    if bytes.is_empty() {
        return Err(TileFetchError::Empty);
    }
    if gzipped && !encoding::is_gzip(&bytes) {
        return Err(TileFetchError::Garbled(
            "labelled gzip but not a gzip stream".to_string(),
        ));
    }
    Ok((bytes, gzipped))
}

/// Whether a declared `Content-Length` is already past `cap`.
fn declared_past_cap(declared: Option<u64>, cap: usize) -> bool {
    declared.is_some_and(|len| len > cap as u64)
}

/// A body read chunk by chunk, stopping at the first chunk that takes it past
/// `cap` bytes. A declared length is not trusted to bound it: a host can omit
/// it, or send more than it declared.
async fn read_capped<S, B, E>(mut stream: S, cap: usize) -> Result<Vec<u8>, TileFetchError>
where
    S: Stream<Item = Result<B, E>> + Unpin,
    B: AsRef<[u8]>,
    E: std::fmt::Display,
{
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| TileFetchError::Unreachable(e.to_string()))?;
        let chunk = chunk.as_ref();
        if body.len() + chunk.len() > cap {
            return Err(TileFetchError::TooLarge { cap });
        }
        body.extend_from_slice(chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunks(sizes: &[usize]) -> impl Stream<Item = Result<Vec<u8>, String>> + Unpin {
        futures::stream::iter(sizes.iter().map(|&n| Ok(vec![7u8; n])).collect::<Vec<_>>())
    }

    fn read(sizes: &[usize], cap: usize) -> Result<Vec<u8>, TileFetchError> {
        futures::executor::block_on(read_capped(chunks(sizes), cap))
    }

    #[test]
    fn a_body_exactly_at_the_cap_is_read_whole() {
        let body = read(&[4, 4, 2], 10).expect("at the cap");
        assert_eq!(body.len(), 10);
    }

    #[test]
    fn a_body_one_byte_past_the_cap_is_refused() {
        assert!(matches!(
            read(&[4, 4, 3], 10),
            Err(TileFetchError::TooLarge { cap: 10 })
        ));
    }

    #[test]
    fn a_single_chunk_past_the_cap_is_refused() {
        assert!(matches!(
            read(&[11], 10),
            Err(TileFetchError::TooLarge { cap: 10 })
        ));
    }

    #[test]
    fn an_empty_body_reads_as_empty() {
        assert_eq!(read(&[], 10).expect("empty").len(), 0);
    }

    /// A stream that breaks mid-body is the host going away, not a tile.
    #[test]
    fn a_stream_that_breaks_is_unreachable() {
        let broken = futures::stream::iter(vec![Ok(vec![1u8; 3]), Err("reset".to_string())]);
        let read = futures::executor::block_on(read_capped(broken, 10));
        assert!(matches!(read, Err(TileFetchError::Unreachable(_))));
    }

    #[test]
    fn a_declared_length_past_the_cap_is_refused_before_reading() {
        assert!(declared_past_cap(Some(11), 10));
        assert!(!declared_past_cap(Some(10), 10));
        assert!(!declared_past_cap(None, 10));
    }

    /// A gzip of zeroes is about a thousandth of what it inflates to, so a body
    /// well inside the wire cap can still be past it once decompressed.
    #[test]
    fn a_gzip_that_inflates_past_the_cap_is_refused() {
        use std::io::Write;
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        gz.write_all(&vec![0u8; 64 * 1024]).expect("gzip");
        let sent = gz.finish().expect("gzip");
        assert!(sent.len() < 1024);

        assert_eq!(
            encoding::gunzip_at_most(&sent, 64 * 1024)
                .expect("inflates")
                .map(|b| b.len()),
            Some(64 * 1024)
        );
        assert_eq!(
            encoding::gunzip_at_most(&sent, 64 * 1024 - 1).expect("inflates"),
            None
        );
    }
    /// A pan asks for two dozen tiles at once and every one of them can be a
    /// miss. On HTTP/1.1 each opens its own connection and pays its own TLS
    /// handshake; on HTTP/2 they share one. `reqwest` is pulled in with
    /// `default-features = false` and `http2` is one of the defaults that
    /// drops, which is how the tile client spent its first release unable to
    /// negotiate it. Naming a builder method that exists only under the
    /// feature fails the build if it is dropped again, which no runtime
    /// assertion could do without a tile host to talk to.
    #[test]
    fn the_tile_client_can_negotiate_http2() {
        let _: fn(reqwest::ClientBuilder) -> reqwest::ClientBuilder =
            reqwest::ClientBuilder::http2_prior_knowledge;
    }

    /// A loopback host that answers every request on a connection with one
    /// small body and keeps the connection open, counting the connections it
    /// accepts.
    fn counting_host() -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        let (url, accepted, _) = holding_host(Duration::ZERO);
        (url, accepted)
    }

    /// [`counting_host`] holding every answer for `hold`, and also counting
    /// the connections it had accepted when it sent its first answer.
    fn holding_host(
        hold: Duration,
    ) -> (
        String,
        std::sync::Arc<std::sync::atomic::AtomicUsize>,
        std::sync::Arc<std::sync::OnceLock<usize>>,
    ) {
        use std::io::{BufRead, BufReader, Write};
        use std::sync::atomic::{AtomicUsize, Ordering};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let accepted = std::sync::Arc::new(AtomicUsize::new(0));
        let at_first_answer = std::sync::Arc::new(std::sync::OnceLock::new());
        let counter = accepted.clone();
        let first = at_first_answer.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                counter.fetch_add(1, Ordering::SeqCst);
                let counter = counter.clone();
                let first = first.clone();
                std::thread::spawn(move || {
                    let mut writer = stream.try_clone().expect("clone");
                    let mut reader = BufReader::new(stream);
                    loop {
                        let mut line = String::new();
                        let mut head = true;
                        let mut asked_head = false;
                        loop {
                            line.clear();
                            match reader.read_line(&mut line) {
                                Ok(0) | Err(_) => return,
                                Ok(_) if line == "\r\n" => break,
                                Ok(_) => {}
                            }
                            if head {
                                asked_head = line.starts_with("HEAD ");
                                head = false;
                            }
                        }
                        std::thread::sleep(hold);
                        let _ = first.set(counter.load(Ordering::SeqCst));
                        let reply = if asked_head {
                            "HTTP/1.1 200 OK\r\ncontent-length: 4\r\n\r\n"
                        } else {
                            "HTTP/1.1 200 OK\r\ncontent-length: 4\r\n\r\ntile"
                        };
                        if writer.write_all(reply.as_bytes()).is_err() {
                            return;
                        }
                    }
                });
            }
        });
        (
            format!("http://{}/0/0/0.pbf", addr),
            accepted,
            at_first_answer,
        )
    }

    /// A pan on a cold pool asks for two dozen tiles at once. Until one
    /// connection has answered, the client cannot know the host speaks HTTP/2,
    /// so each request would open a connection and a handshake of its own and
    /// all of them would contend for the radio. One goes first and the rest
    /// wait for it.
    #[test]
    fn a_burst_on_a_cold_pool_opens_one_connection_before_it_fans_out() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .expect("runtime");
        let (url, accepted, at_first_answer) = holding_host(Duration::from_millis(300));
        let fetcher = std::sync::Arc::new(TileFetcher::new(Duration::ZERO).expect("fetcher"));
        runtime.block_on(async {
            let burst: Vec<_> = (0..24)
                .map(|_| {
                    let fetcher = fetcher.clone();
                    let url = url.clone();
                    tokio::spawn(async move { fetcher.fetch(&url).await })
                })
                .collect();
            for fetch in burst {
                assert_eq!(fetch.await.expect("join").expect("tile"), b"tile");
            }
        });
        assert_eq!(at_first_answer.get().copied(), Some(1));
        assert!(accepted.load(std::sync::atomic::Ordering::SeqCst) >= 1);
    }

    /// What [`http2_host`] counts.
    struct Http2Host {
        url: String,
        /// Connections accepted.
        accepted: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        /// Requests arrived.
        asked: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        /// Requests arrived when the first answer was sent.
        at_first_answer: std::sync::Arc<std::sync::OnceLock<usize>>,
    }

    /// A loopback host speaking HTTP/2 without TLS, as a client that already
    /// knows the host speaks it reaches one. It holds every answer for
    /// `hold`, and counts the connections it accepts and the requests that
    /// had arrived when it sent its first answer.
    async fn http2_host(hold: Duration) -> Http2Host {
        http2_host_holding_until(usize::MAX, hold).await
    }

    /// [`http2_host`] holding every answer until `requests` requests have
    /// arrived, or until `deadline` passes, whichever is first. A burst is
    /// counted by what reaches the host before any answer frees a request to
    /// follow it, not by what a loaded scheduler gets onto the wire inside a
    /// fixed hold.
    async fn http2_host_holding_until(requests: usize, deadline: Duration) -> Http2Host {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let accepted = std::sync::Arc::new(AtomicUsize::new(0));
        let asked = std::sync::Arc::new(AtomicUsize::new(0));
        let asked_count = asked.clone();
        let (arrived, _) = tokio::sync::watch::channel(0usize);
        let arrived = std::sync::Arc::new(arrived);
        let at_first_answer = std::sync::Arc::new(std::sync::OnceLock::new());
        let (counter, first) = (accepted.clone(), at_first_answer.clone());
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                counter.fetch_add(1, Ordering::SeqCst);
                let (asked, arrived, first) = (asked.clone(), arrived.clone(), first.clone());
                tokio::spawn(async move {
                    let Ok(mut connection) = h2::server::handshake(socket).await else {
                        return;
                    };
                    while let Some(Ok((request, mut respond))) = connection.accept().await {
                        let mut released = arrived.subscribe();
                        asked.fetch_add(1, Ordering::SeqCst);
                        arrived.send_modify(|n| *n += 1);
                        let (asked, first) = (asked.clone(), first.clone());
                        let bodiless = request.method() == http::Method::HEAD;
                        tokio::spawn(async move {
                            let _ = tokio::time::timeout(
                                deadline,
                                released.wait_for(|n| *n >= requests),
                            )
                            .await;
                            let _ = first.set(asked.load(Ordering::SeqCst));
                            let response = http::Response::new(());
                            if let Ok(mut body) = respond.send_response(response, bodiless)
                                && !bodiless
                            {
                                let _ = body.send_data(bytes::Bytes::from_static(b"tile"), true);
                            }
                        });
                    }
                });
            }
        });
        Http2Host {
            url: format!("http://{}/0/0/0.pbf", addr),
            accepted,
            asked: asked_count,
            at_first_answer,
        }
    }

    /// A pan that resumes after a pause, on a host known to speak HTTP/2
    /// whose connection the pool has let go. The whole burst shares the one
    /// connection its first request opens and goes out together, rather than
    /// paying a connection and a handshake per request, or waiting on one
    /// request sent alone. The host answers nothing until the whole burst has
    /// reached it, so a loaded runner that is slow to schedule the requests
    /// still counts all of them, and a burst that does not go out together
    /// leaves the host waiting out its deadline with fewer.
    ///
    /// Runs on one thread. The pool polls a request's checkout and then its
    /// connect, and a connection that completes on another worker between the
    /// two polls finds no connect in progress and opens a second one. That is
    /// the pool's race rather than the fetcher's, and only a runtime that
    /// polls one task at a time rules it out.
    #[test]
    fn a_burst_to_an_http2_host_with_no_open_connection_shares_one_and_goes_out_together() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let Http2Host {
                url,
                accepted,
                at_first_answer,
                ..
            } = http2_host_holding_until(24, Duration::from_secs(10)).await;
            let fetcher = std::sync::Arc::new(TileFetcher::new(Duration::ZERO).expect("fetcher"));
            fetcher
                .hosts
                .lock()
                .expect("hosts")
                .insert(host_key(&url), answered_now(false));
            let burst: Vec<_> = (0..24)
                .map(|_| {
                    let fetcher = fetcher.clone();
                    let url = url.clone();
                    tokio::spawn(async move { fetcher.fetch(&url).await })
                })
                .collect();
            for fetch in burst {
                assert_eq!(fetch.await.expect("join").expect("tile"), b"tile");
            }
            assert_eq!(accepted.load(std::sync::atomic::Ordering::SeqCst), 1);
            assert_eq!(at_first_answer.get().copied(), Some(24));
            assert!(
                fetcher.leaders.lock().expect("leaders").is_empty(),
                "a request of the burst went alone first"
            );
        });
    }

    /// A request that never reached the host may have found its connection
    /// closed, by the host, by a NAT, or by a keep-alive ping that went
    /// unanswered, so the next burst goes as on a cold pool.
    #[test]
    fn a_send_error_leads_the_next_burst() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let url = format!("http://{}/0/0/0.pbf", listener.local_addr().expect("addr"));
        drop(listener);
        let fetcher = TileFetcher::new(Duration::ZERO).expect("fetcher");
        let host = host_key(&url);
        fetcher
            .hosts
            .lock()
            .expect("hosts")
            .insert(host.clone(), answered_now(false));
        assert!(!fetcher.leads(&host));

        let refused = runtime.block_on(fetcher.fetch(&url));
        assert!(matches!(refused, Err(TileFetchError::Unreachable(_))));
        assert!(fetcher.leads(&host));
    }

    /// A host never heard from sends one request first, since the pool cannot
    /// know it speaks HTTP/2. A host known to does not, since its client
    /// shares one connect across the burst, and neither does an HTTP/1.1
    /// host, whose burst needs a connection per request whatever goes first.
    #[test]
    fn a_burst_is_led_only_for_a_host_never_heard_from() {
        assert!(leads_burst(None));
        assert!(!leads_burst(Some(answered_now(false))));
        assert!(!leads_burst(Some(answered_now(true))));
    }

    #[test]
    fn hosts_are_told_apart_by_scheme_host_and_port() {
        assert_eq!(
            host_key("https://tiles.example.org/planet/1/2/3.pbf"),
            host_key("https://tiles.example.org:443/other/4/5/6.pbf")
        );
        assert_ne!(
            host_key("https://tiles.example.org/1/2/3.pbf"),
            host_key("http://tiles.example.org/1/2/3.pbf")
        );
        assert_ne!(
            host_key("https://a.example.org/1/2/3.pbf"),
            host_key("https://b.example.org/1/2/3.pbf")
        );
    }

    /// A pan that resumes after a two-minute pause opens a connection of its
    /// own: a burst on a connection idle that long comes back slower than one
    /// on a connection opened for it. One after a twenty-second pause is
    /// still carried by the connection the last pan used. The clock is paused
    /// only across each idle, so the requests themselves run on real time.
    #[test]
    fn a_connection_idle_for_a_pan_pause_is_replaced_and_one_idle_twenty_seconds_is_reused() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let (url, accepted) = counting_host();
        let connections = || accepted.load(std::sync::atomic::Ordering::SeqCst);
        runtime.block_on(async {
            let fetcher = TileFetcher::new(Duration::ZERO).expect("fetcher");
            assert_eq!(fetcher.fetch(&url).await.expect("first"), b"tile");

            idle(Duration::from_secs(20)).await;
            assert_eq!(fetcher.fetch(&url).await.expect("inside"), b"tile");
            assert_eq!(connections(), 1);

            idle(Duration::from_secs(120)).await;
            assert_eq!(fetcher.fetch(&url).await.expect("past"), b"tile");
            assert_eq!(connections(), 2);
        });
    }

    /// An answer from a host, stamped now.
    fn answered_now(http1: bool) -> HostAnswer {
        HostAnswer {
            http1,
            at: tokio::time::Instant::now(),
        }
    }

    /// Let `span` pass on the paused clock the pool keeps its idle time by.
    async fn idle(span: Duration) {
        tokio::time::pause();
        tokio::time::advance(span).await;
        tokio::task::yield_now().await;
        tokio::time::resume();
    }

    /// A pan after a pause longer than the pool keeps a connection. The warm
    /// sent on the gesture's start opens the connection, and the burst that
    /// follows 20 ms later rides it rather than opening its own: no connection
    /// is accepted after the warm's.
    #[test]
    fn a_warm_after_a_pan_pause_opens_the_connection_the_next_burst_rides() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let connections = |accepted: &std::sync::atomic::AtomicUsize| {
            accepted.load(std::sync::atomic::Ordering::SeqCst)
        };
        runtime.block_on(async {
            let Http2Host { url, accepted, .. } = http2_host(Duration::from_millis(100)).await;
            let fetcher = std::sync::Arc::new(TileFetcher::new(Duration::ZERO).expect("fetcher"));
            fetcher
                .hosts
                .lock()
                .expect("hosts")
                .insert(host_key(&url), answered_now(false));
            assert_eq!(fetcher.fetch(&url).await.expect("first"), b"tile");
            assert_eq!(connections(&accepted), 1);

            idle(POOL_IDLE_TIMEOUT + Duration::from_secs(5)).await;

            let warm = {
                let (fetcher, url) = (fetcher.clone(), url.clone());
                tokio::spawn(async move { fetcher.warm(&url).await })
            };
            tokio::time::sleep(Duration::from_millis(20)).await;
            let until = tokio::time::Instant::now() + Duration::from_secs(2);
            while connections(&accepted) < 2 && tokio::time::Instant::now() < until {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            assert_eq!(connections(&accepted), 2, "the warm opened no connection");

            let burst: Vec<_> = (0..24)
                .map(|_| {
                    let (fetcher, url) = (fetcher.clone(), url.clone());
                    tokio::spawn(async move { fetcher.fetch(&url).await })
                })
                .collect();
            for fetch in burst {
                assert_eq!(fetch.await.expect("join").expect("tile"), b"tile");
            }
            warm.await.expect("warm");
            assert_eq!(connections(&accepted), 2, "the burst opened a connection");
        });
    }

    /// A warm on a host answered inside the pool's idle window costs nothing:
    /// the connection is still open, so nothing goes on the wire.
    #[test]
    fn a_warm_inside_the_idle_window_sends_nothing() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let Http2Host { url, asked, .. } = http2_host(Duration::ZERO).await;
            let fetcher = TileFetcher::new(Duration::ZERO).expect("fetcher");
            fetcher
                .hosts
                .lock()
                .expect("hosts")
                .insert(host_key(&url), answered_now(false));
            assert_eq!(fetcher.fetch(&url).await.expect("first"), b"tile");
            let before = asked.load(std::sync::atomic::Ordering::SeqCst);

            idle(POOL_IDLE_TIMEOUT - Duration::from_secs(5)).await;
            fetcher.warm(&url).await;

            assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), before);
        });
    }

    /// A warm on a host never heard from takes the leader's turn, so a burst
    /// arriving while its handshake is under way waits on it: one connection
    /// is open when the first answer goes back, not one per request.
    #[test]
    fn a_warm_on_a_host_never_heard_from_leads_the_burst_behind_it() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .expect("runtime");
        let (url, _, at_first_answer) = holding_host(Duration::from_millis(300));
        let fetcher = std::sync::Arc::new(TileFetcher::new(Duration::ZERO).expect("fetcher"));
        runtime.block_on(async {
            let warm = {
                let (fetcher, url) = (fetcher.clone(), url.clone());
                tokio::spawn(async move { fetcher.warm(&url).await })
            };
            tokio::time::sleep(Duration::from_millis(20)).await;
            let burst: Vec<_> = (0..24)
                .map(|_| {
                    let (fetcher, url) = (fetcher.clone(), url.clone());
                    tokio::spawn(async move { fetcher.fetch(&url).await })
                })
                .collect();
            for fetch in burst {
                assert_eq!(fetch.await.expect("join").expect("tile"), b"tile");
            }
            warm.await.expect("warm");
        });
        assert_eq!(at_first_answer.get().copied(), Some(1));
    }

    /// A warm that cannot reach its host forgets what the host last showed,
    /// as a failed tile does, so the next burst goes as on a cold pool.
    #[test]
    fn a_warm_that_cannot_reach_its_host_leads_the_next_burst() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let url = format!("http://{}/0/0/0.pbf", listener.local_addr().expect("addr"));
        drop(listener);
        let fetcher = TileFetcher::new(Duration::ZERO).expect("fetcher");
        let host = host_key(&url);
        runtime.block_on(async {
            fetcher
                .hosts
                .lock()
                .expect("hosts")
                .insert(host.clone(), answered_now(false));
            idle(POOL_IDLE_TIMEOUT + Duration::from_secs(1)).await;
            fetcher.warm(&url).await;
        });
        assert!(fetcher.leads(&host));
    }
}
