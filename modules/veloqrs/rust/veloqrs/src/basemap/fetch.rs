//! Filling the tile store from third-party tile hosts.
//!
//! Deliberately not the intervals.icu governor. That lane is shaped around one
//! base URL, mandatory auth and intervals.icu's own rate headers, none of which
//! a tile host has. Sharing it would also spend the athlete's intervals.icu
//! budget on imagery, which is not what that budget is for.

use super::TileStore;
use super::encoding;
use reqwest::header::{ACCEPT_ENCODING, CONTENT_ENCODING};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Identifies the app to tile hosts, most of which ask for it in their terms.
const TILE_USER_AGENT: &str = concat!("veloq/", env!("CARGO_PKG_VERSION"), " (+https://veloq.fit)");

/// One tile request every this often while filling the store. Background work
/// on someone else's servers, so it is paced well under what a map pan asks
/// for interactively.
pub const FILL_PACE: Duration = Duration::from_millis(100);

/// A tile request never reached a tile.
#[derive(Debug, thiserror::Error)]
pub enum TileFetchError {
    #[error("tile host unreachable: {0}")]
    Unreachable(String),
    #[error("tile host answered {status}")]
    Rejected { status: u16 },
    #[error("tile host answered with an empty body")]
    Empty,
    #[error("tile host sent a body that does not decode: {0}")]
    Garbled(String),
    #[error("could not store the tile: {0}")]
    Store(String),
}

/// A `reqwest` client of its own, paced by itself.
#[derive(Debug)]
pub struct TileFetcher {
    client: reqwest::Client,
    pace: Duration,
    /// The earliest a request may start. Reserved under the lock and waited on
    /// outside it, so concurrent callers queue rather than all sleeping to the
    /// same instant and firing together.
    next_slot: Mutex<Option<Instant>>,
}

impl TileFetcher {
    pub fn new(pace: Duration) -> Result<Self, String> {
        // gzip is asked for on every request and decompressed here rather than
        // by `reqwest`, so a tile can be kept as the host sent it. `reqwest`
        // would otherwise decompress before anything could see the body, and
        // a client that stopped asking would put half as many bytes again on
        // the wire with nothing counting them.
        let client = reqwest::Client::builder()
            .user_agent(TILE_USER_AGENT)
            .timeout(Duration::from_secs(20))
            .no_gzip()
            .build()
            .map_err(|e| format!("tile client: {}", e))?;
        Ok(Self {
            client,
            pace,
            next_slot: Mutex::new(None),
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
        let (sent, gzipped) = self.body(url).await?;
        if !gzipped {
            return Ok(sent);
        }
        encoding::gunzip(&sent).map_err(|e| TileFetchError::Garbled(e.to_string()))
    }

    /// One tile's body as the host sent it: gzipped when the host gzipped it,
    /// which is how the store keeps it. Fails as [`fetch`](Self::fetch) does,
    /// and also on a body in an encoding never asked for, or labelled gzip and
    /// not a gzip stream, since nothing could decode either once kept.
    pub async fn fetch_as_sent(&self, url: &str) -> Result<Vec<u8>, TileFetchError> {
        self.body(url).await.map(|(sent, _)| sent)
    }

    /// The body as sent, and whether the host gzipped it.
    async fn body(&self, url: &str) -> Result<(Vec<u8>, bool), TileFetchError> {
        self.wait_for_slot().await;

        let response = self
            .client
            .get(url)
            .header(ACCEPT_ENCODING, "gzip")
            .send()
            .await
            .map_err(|e| TileFetchError::Unreachable(e.to_string()))?;

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

        let bytes = response
            .bytes()
            .await
            .map_err(|e| TileFetchError::Unreachable(e.to_string()))?;
        if bytes.is_empty() {
            return Err(TileFetchError::Empty);
        }
        if gzipped && !encoding::is_gzip(&bytes) {
            return Err(TileFetchError::Garbled(
                "labelled gzip but not a gzip stream".to_string(),
            ));
        }
        Ok((bytes.to_vec(), gzipped))
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

#[cfg(test)]
mod tests {
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
}
