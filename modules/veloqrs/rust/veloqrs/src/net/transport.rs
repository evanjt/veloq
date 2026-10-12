//! The single pooled transport for intervals.icu.
//!
//! Every request passes through the shared `Governor` (dispatch pace + policy
//! hook) and a unified retry loop that honours `Retry-After`. The auth header is
//! built once from the credential the transport holds - callers never pass an
//! `auth_header` per request.

use crate::governor::{
    self, Admission, AfterRefusal, AuthMethod, Dispatch, Governor, Lane, RateBudget,
};
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Retries for transient failures (429 / 5xx / transport). Matches the prior
/// axios client (`maxRetries = 3`).
pub(crate) const MAX_RETRIES: u32 = 3;

/// How long each lane may spend on one request, and how long the whole retry
/// loop may run for the lane a user is waiting on.
///
/// A total timeout on its own does nothing for the worst case, which is not a
/// dead network but a live one that accepts and then goes quiet: a captive
/// portal, hotel wifi, a black-holed DNS. There every attempt runs the full
/// ceiling, so the retries multiply it. Aeroplane mode fails in milliseconds by
/// comparison. So the interactive lane gets a short per-attempt ceiling and a
/// whole-request budget that stops it retrying into a wait nobody will sit
/// through, while backfill, which no one is watching, keeps the long ceiling
/// and the full retry budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LaneTimeouts {
    /// TCP connect ceiling, shared by both lanes. Without it a handshake that
    /// never completes burns a whole attempt.
    pub connect: Duration,
    /// Per-attempt ceiling for work a user is waiting on.
    pub interactive: Duration,
    /// Per-attempt ceiling for opportunistic backfill.
    pub backfill: Duration,
    /// Whole-request ceiling for the interactive lane, retries and backoff
    /// included.
    pub interactive_budget: Duration,
}

impl Default for LaneTimeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(5),
            // Wide enough for a FIT file over a poor mobile connection, far
            // short of the two minutes the old 4 x 30s worst case cost.
            interactive: Duration::from_secs(8),
            backfill: Duration::from_secs(30),
            interactive_budget: Duration::from_secs(10),
        }
    }
}

impl LaneTimeouts {
    /// The ceiling for the attempt about to be dispatched. A budgeted lane
    /// never gets more than the budget has left, so the retries add up to the
    /// budget rather than multiplying the per-attempt ceiling.
    fn attempt(&self, lane: Lane, started: Instant) -> Duration {
        self.attempt_at(lane, started, Instant::now())
    }

    /// [`Self::attempt`] as it stands at `now`, so the remainder is a function
    /// of its inputs rather than of when it was asked.
    fn attempt_at(&self, lane: Lane, started: Instant, now: Instant) -> Duration {
        match self.budget(lane) {
            None => self.backfill,
            Some(budget) => self
                .interactive
                .min(budget.saturating_sub(now.saturating_duration_since(started))),
        }
    }

    /// Whether an attempt given `timeout` was cut short by the budget rather
    /// than given the lane's full per-attempt ceiling.
    fn cut_by_budget(&self, lane: Lane, timeout: Duration) -> bool {
        self.budget(lane).is_some() && timeout < self.interactive
    }

    /// The whole-request ceiling for `lane`, if it has one.
    fn budget(&self, lane: Lane) -> Option<Duration> {
        match lane {
            Lane::Interactive => Some(self.interactive_budget),
            Lane::Backfill => None,
        }
    }
}

/// A failed request, classified so the service can react (e.g. `Unauthorized`
/// drives the `authExpired` status).
#[derive(Debug)]
pub enum NetError {
    /// 401 - credentials rejected; the service emits `authExpired`.
    Unauthorized,
    /// 429 after exhausting retries.
    RateLimited,
    /// The request budget sent nothing, or a refusal set a cooldown: nothing
    /// is sent for this work before `until`. Not a failure of the work, which
    /// is still owed, and never a reason to back it off further.
    Deferred {
        until: chrono::DateTime<chrono::Utc>,
    },
    /// Any other non-success HTTP status.
    Http { status: u16, body: String },
    /// Network / timeout failure after retries.
    Transport(String),
    /// Body did not deserialize into the expected shape.
    Decode(String),
    /// A local file backing a request body could not be read. Not a network
    /// failure, so it must never be queued for a connectivity retry.
    Io(String),
    /// A local read the step depended on failed. Not a network failure and
    /// never worth a connectivity retry: what the step needed is in the
    /// database, and the page it fetched is not written without it.
    Storage(String),
    /// A local write the step depended on failed because the device has no
    /// space left. Not a network failure, and a retry fails the same way until
    /// space is freed, so the athlete is told to free it.
    StorageFull(String),
    /// The engine was gone when the step went to write what it had fetched.
    /// A restore or a clear-and-sync destroys it mid-run, and the bytes are
    /// then dropped. Not a network failure and never worth a retry: the
    /// library the run was writing into no longer exists.
    EngineClosed,
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NetError::Unauthorized => write!(f, "unauthorized (401)"),
            NetError::RateLimited => write!(f, "rate limited (429) after retries"),
            NetError::Deferred { until } => {
                write!(f, "{DEFERRED_ERROR_PREFIX} until {}", until.to_rfc3339())
            }
            NetError::Http { status, body } => write!(f, "HTTP {}: {}", status, body),
            NetError::EngineClosed => write!(f, "the engine closed during the run"),
            NetError::Transport(e) => write!(f, "transport error: {}", e),
            NetError::Decode(e) => write!(f, "decode error: {}", e),
            NetError::Io(e) => write!(f, "file error: {}", e),
            NetError::Storage(e) => write!(f, "local read failed: {}", e),
            NetError::StorageFull(e) => write!(f, "device storage is full: {}", e),
        }
    }
}

/// How a deferral's text begins, for the callers that carry a failure as its
/// text and still have to tell a deferral from a failure.
pub const DEFERRED_ERROR_PREFIX: &str = "deferred by the request budget";

impl std::error::Error for NetError {}

impl NetError {
    /// A database failure behind a step, named by `context`. A full disk is
    /// told apart here, where the SQLite code is still in hand, because the
    /// message it becomes carries no code a later reader could trust.
    pub fn storage(context: impl std::fmt::Display, e: &rusqlite::Error) -> Self {
        let message = format!("{context}: {e}");
        if crate::persistence::is_disk_full(e) {
            NetError::StorageFull(message)
        } else {
            NetError::Storage(message)
        }
    }

    /// The request never reached the server or timed out, so the network is
    /// absent and the same request is as likely to work once it returns. A
    /// rate limit or a 5xx is the server answering, and is not this.
    pub fn is_network_absent(&self) -> bool {
        matches!(self, NetError::Transport(_))
    }

    /// The request budget held the work back: it is owed, nothing is wrong
    /// with it, and asking sooner than the deferral says sends nothing.
    pub fn is_deferred(&self) -> bool {
        matches!(self, NetError::Deferred { .. })
    }

    /// intervals.icu or the request budget said not now: a deferral, or a
    /// 429 the retries ran out on. It speaks for every request behind it, so
    /// a walk over many stops at the first one rather than asking the rest,
    /// and nothing about the item asked for is wrong.
    pub fn is_refusal(&self) -> bool {
        matches!(self, NetError::Deferred { .. } | NetError::RateLimited)
    }
}

/// Pooled HTTP transport bound to one base URL and one credential.
///
/// Cloning shares the pool: `Client` is a handle and the governor is an `Arc`,
/// so a clone is the same connections and the same rate limit, not a second
/// one. Cheap enough to hand a copy to a caller that outlives the original.
#[derive(Clone)]
pub struct Transport {
    client: Client,
    base_url: String,
    auth_header: String,
    governor: Arc<Governor>,
    timeouts: LaneTimeouts,
}

/// One client for the whole process, so a spawned job reuses the connection the
/// last one opened.
///
/// A transport used to be built per job and each built its own client, so the
/// pool settings below did nothing across jobs: the pool went with the
/// transport and every on-demand fetch paid a TCP connect and a TLS handshake,
/// 100 to 300 ms on mobile, before the request a screen was waiting on. The
/// credential is not the client's, so one pool serves every athlete and every
/// lane; the governor is shared the same way.
///
/// `Client` is a handle, so the clone is the same pool rather than a copy of it.
static SHARED_CLIENT: std::sync::OnceLock<Result<Client, String>> = std::sync::OnceLock::new();

fn shared_client() -> Result<Client, String> {
    SHARED_CLIENT
        .get_or_init(|| build_client(LaneTimeouts::default()))
        .clone()
}

fn build_client(timeouts: LaneTimeouts) -> Result<Client, String> {
    Client::builder()
        // Sends `Accept-Encoding: gzip` and decodes the body transparently.
        .gzip(true)
        .pool_max_idle_per_host(16)
        .pool_idle_timeout(Duration::from_secs(60))
        .tcp_keepalive(Duration::from_secs(30))
        .connect_timeout(timeouts.connect)
        // The floor for a request that names no lane ceiling of its own.
        .timeout(timeouts.backfill)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {}", e))
}

impl Transport {
    /// Build a transport on the shared process governor.
    pub fn new(base_url: impl Into<String>, auth: AuthMethod<'_>) -> Result<Self, String> {
        Self::with_governor(base_url, auth, governor::GOVERNOR.clone())
    }

    /// Build a transport on a specific governor (used by tests for an isolated,
    /// fast-paced limiter).
    pub fn with_governor(
        base_url: impl Into<String>,
        auth: AuthMethod<'_>,
        governor: Arc<Governor>,
    ) -> Result<Self, String> {
        Self::with_timeouts(base_url, auth, governor, LaneTimeouts::default())
    }

    /// Build a transport with explicit lane timeouts.
    ///
    /// The client is shared for the default timeouts, which is every caller in
    /// the app: only tests pass their own, and those build one of their own so
    /// a test's short ceilings never reach a real request.
    pub fn with_timeouts(
        base_url: impl Into<String>,
        auth: AuthMethod<'_>,
        governor: Arc<Governor>,
        timeouts: LaneTimeouts,
    ) -> Result<Self, String> {
        let client = if timeouts == LaneTimeouts::default() {
            shared_client()?
        } else {
            build_client(timeouts)?
        };
        Ok(Self {
            client,
            base_url: base_url.into(),
            auth_header: governor::format_auth_header(auth),
            governor,
            timeouts,
        })
    }

    /// When the work `e` refused may be asked for again, or `None` when `e`
    /// is not a refusal. A deferral carries its own time; a 429 the retries
    /// ran out on waits for the cooldown it left, or the first rung of the
    /// cooldown ladder when it left none.
    pub fn refusal_lifts_at(
        &self,
        e: &NetError,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        match e {
            NetError::Deferred { until } => Some(*until),
            NetError::RateLimited => Some(self.governor.refusal_lifts_at(now)),
            _ => None,
        }
    }

    /// When work refused at `now` may be asked for again: the end of the
    /// governor's cooldown, or the first rung of its ladder when none holds.
    pub fn cooldown_lifts_at(
        &self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> chrono::DateTime<chrono::Utc> {
        self.governor.refusal_lifts_at(now)
    }

    /// Until when a refusal from intervals.icu holds every request at `now`,
    /// or `None` when none does. A deferral outside one is the install's own
    /// allowance, not intervals.icu.
    pub fn cooldown_until(
        &self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        self.governor.cooldown_until(now)
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// GET a path and deserialize the JSON body into `T`.
    pub async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        dispatch: impl Into<Dispatch>,
    ) -> Result<T, NetError> {
        let body = self.get_bytes(path, query, dispatch).await?;
        serde_json::from_slice::<T>(&body).map_err(|e| NetError::Decode(e.to_string()))
    }

    /// GET a path and return the raw response bytes (e.g. a FIT file).
    pub async fn get_bytes(
        &self,
        path: &str,
        query: &[(&str, &str)],
        dispatch: impl Into<Dispatch>,
    ) -> Result<Vec<u8>, NetError> {
        let dispatch = dispatch.into();
        let lane = dispatch.lane;
        let url = self.url(path);
        let mut attempt = 0u32;
        let started = Instant::now();
        // What the last attempt failed with, returned as it stands when the
        // governor's wait for the next slot leaves no budget to send it in, or
        // too little for the retry to finish.
        let mut last: Option<NetError> = None;
        loop {
            // Single shared choke point: the budget, then the pace.
            let probe = match self.governor.acquire(dispatch).await {
                Admission::Deferred { until } => return Err(NetError::Deferred { until }),
                admission => admission == Admission::Probe,
            };
            let timeout = self.timeouts.attempt(lane, started);
            if timeout.is_zero() {
                return Err(last.unwrap_or_else(budget_spent));
            }

            let send = self
                .client
                .get(&url)
                .header("Authorization", &self.auth_header)
                .query(query)
                .timeout(timeout)
                .send()
                .await;

            match send {
                Ok(resp) => {
                    let status = resp.status();
                    let budget = parse_budget(resp.headers());

                    if status.is_success() {
                        self.note_success(&budget);
                        return resp
                            .bytes()
                            .await
                            .map(|b| b.to_vec())
                            .map_err(|e| NetError::Transport(e.to_string()));
                    }
                    if status == reqwest::StatusCode::UNAUTHORIZED {
                        return Err(NetError::Unauthorized);
                    }
                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        if let AfterRefusal::Cooldown { until } =
                            self.note_refusal(resp, &budget, probe).await
                        {
                            return Err(NetError::Deferred { until });
                        }
                        attempt += 1;
                        let wait = governor::decide_backoff(
                            budget.retry_after_secs,
                            attempt,
                            true,
                            self.governor.jitter(),
                        );
                        if attempt > MAX_RETRIES || !self.retry_fits(lane, started, wait) {
                            return Err(NetError::RateLimited);
                        }
                        last = Some(NetError::RateLimited);
                        governor::pause(wait).await;
                        continue;
                    }
                    let code = status.as_u16();
                    let body = resp.text().await.unwrap_or_default();
                    let failed = NetError::Http { status: code, body };
                    if status.is_server_error() && attempt < MAX_RETRIES {
                        let wait = governor::decide_backoff(
                            None,
                            attempt + 1,
                            false,
                            self.governor.jitter(),
                        );
                        if self.retry_fits(lane, started, wait) {
                            attempt += 1;
                            last = Some(failed);
                            governor::pause(wait).await;
                            continue;
                        }
                    }
                    return Err(failed);
                }
                Err(e) => {
                    attempt += 1;
                    let wait =
                        governor::decide_backoff(None, attempt, false, self.governor.jitter());
                    if attempt > MAX_RETRIES || !self.retry_fits(lane, started, wait) {
                        // A retry sent with only what the budget had left, and
                        // timed out in it, says nothing new about the server,
                        // so the answer worth reporting is the one it retried.
                        let cut_short = self.timeouts.cut_by_budget(lane, timeout);
                        return Err(match last {
                            Some(prev) if cut_short && e.is_timeout() => prev,
                            _ => NetError::Transport(e.to_string()),
                        });
                    }
                    last = Some(NetError::Transport(e.to_string()));
                    governor::pause(wait).await;
                }
            }
        }
    }

    /// POST a JSON body and return the raw response bytes.
    ///
    /// Write retry policy, deliberately narrower than the GET path: only a 429
    /// is retried. A POST that creates an activity may already have been applied
    /// when a 5xx or a dropped connection comes back, so retrying it here risks
    /// a duplicate activity. Those surface to the caller instead, and the upload
    /// queue looks for the activity on the server before it sends again. A 429
    /// is the one safe retry, because the server rejected the request outright.
    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
        dispatch: impl Into<Dispatch>,
    ) -> Result<Vec<u8>, NetError> {
        self.write_json(reqwest::Method::POST, path, body, dispatch.into())
            .await
    }

    /// PUT a JSON body and return the raw response bytes, under the same
    /// write retry policy as `post_json`.
    pub async fn put_json(
        &self,
        path: &str,
        body: &serde_json::Value,
        dispatch: impl Into<Dispatch>,
    ) -> Result<Vec<u8>, NetError> {
        self.write_json(reqwest::Method::PUT, path, body, dispatch.into())
            .await
    }

    async fn write_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &serde_json::Value,
        dispatch: Dispatch,
    ) -> Result<Vec<u8>, NetError> {
        let lane = dispatch.lane;
        let url = self.url(path);
        let mut attempt = 0u32;
        let started = Instant::now();
        loop {
            // Same single choke point as the reads: writes share the budget
            // and the pace.
            let probe = match self.governor.acquire(dispatch).await {
                Admission::Deferred { until } => return Err(NetError::Deferred { until }),
                admission => admission == Admission::Probe,
            };
            let timeout = self.timeouts.attempt(lane, started);
            if timeout.is_zero() {
                // Only a 429 is ever retried here, so a retry that finds the
                // budget spent reports the 429 it was retrying.
                return Err(if attempt == 0 {
                    budget_spent()
                } else {
                    NetError::RateLimited
                });
            }
            let req = self
                .client
                .request(method.clone(), &url)
                .header("Authorization", &self.auth_header)
                .timeout(timeout)
                .json(body);
            let send = req.send().await;
            if attempt > 0
                && self.timeouts.cut_by_budget(lane, timeout)
                && send.as_ref().is_err_and(|e| e.is_timeout())
            {
                // The retry ran in what the budget had left and did not finish
                // in it, so it reports the 429 it was retrying, as a retry the
                // budget left no time for at all does above.
                return Err(NetError::RateLimited);
            }
            match self.settle_write(send, attempt, probe).await {
                WriteStep::Done(result) => return result,
                WriteStep::Backoff(wait) => {
                    if !self.retry_fits(lane, started, wait) {
                        return Err(NetError::RateLimited);
                    }
                    attempt += 1;
                    governor::pause(wait).await;
                }
            }
        }
    }

    /// POST a multipart body whose file part streams straight off the device
    /// filesystem, so a large FIT never lands in memory as bytes.
    ///
    /// `fields` are the plain text parts, in the order the server should see
    /// them. Same write retry policy as `post_json`: 429 only, inside the same
    /// whole-request budget. `timeout` replaces the lane's per-attempt ceiling,
    /// since a large file needs longer to send than a JSON body. The budget
    /// bounds the retries, never the first attempt, so an upload queued behind
    /// other traffic is still sent.
    pub async fn post_multipart(
        &self,
        path: &str,
        file: &FilePart<'_>,
        fields: &[(&str, String)],
        query: &[(&str, &str)],
        dispatch: impl Into<Dispatch>,
        timeout: Duration,
    ) -> Result<Vec<u8>, NetError> {
        let dispatch = dispatch.into();
        let lane = dispatch.lane;
        let url = self.url(path);
        let mut attempt = 0u32;
        let started = Instant::now();
        loop {
            let probe = match self.governor.acquire(dispatch).await {
                Admission::Deferred { until } => return Err(NetError::Deferred { until }),
                admission => admission == Admission::Probe,
            };
            if attempt > 0 && self.timeouts.attempt(lane, started).is_zero() {
                return Err(NetError::RateLimited);
            }
            // Rebuilt every attempt: a streamed body cannot be replayed.
            let mut form = reqwest::multipart::Form::new()
                .part(file.field.to_string(), streamed_file_part(file).await?);
            for (name, value) in fields {
                form = form.text((*name).to_string(), value.clone());
            }
            let req = self
                .client
                .post(&url)
                .header("Authorization", &self.auth_header)
                .query(query)
                .timeout(timeout)
                .multipart(form);
            match self.settle_write(req.send().await, attempt, probe).await {
                WriteStep::Done(result) => return result,
                WriteStep::Backoff(wait) => {
                    if !self.retry_fits(lane, started, wait) {
                        return Err(NetError::RateLimited);
                    }
                    attempt += 1;
                    governor::pause(wait).await;
                }
            }
        }
    }

    /// Whether the backoff still leaves the lane's whole-request budget with
    /// time to dispatch again. A server that fails fast keeps every retry; a
    /// socket that hangs spends the budget on the first attempt and gets none.
    /// Backfill has no budget and always retries.
    fn retry_fits(&self, lane: Lane, started: Instant, wait: Duration) -> bool {
        match self.timeouts.budget(lane) {
            None => true,
            Some(budget) => started.elapsed() + wait < budget,
        }
    }

    /// Hand a success to the governor, and resume at once whatever waited on
    /// a cooldown it ended.
    fn note_success(&self, budget: &RateBudget) {
        if self.governor.note_success(budget, chrono::Utc::now()) {
            crate::net::resume::cooldown_cleared();
        }
    }

    /// Hand a 429 to the governor, whose budget classifies it and decides
    /// between an inline retry and a cooldown, and log the whole response,
    /// since the shape of the application's refusal is known only from what
    /// reaches here. `probe` is whether the refused request was a cooldown's
    /// probe.
    async fn note_refusal(
        &self,
        resp: reqwest::Response,
        budget: &RateBudget,
        probe: bool,
    ) -> AfterRefusal {
        let status = resp.status().as_u16();
        let headers = resp.headers().clone();
        let body = resp.bytes().await.unwrap_or_default();
        let via = headers.get("via").and_then(|v| v.to_str().ok());
        let after = self
            .governor
            .note_refusal(budget, via, &body, probe, chrono::Utc::now());
        log::warn!(
            "veloqrs: [transport] refused, {after:?}: {}",
            refusal_record(status, &headers, &body)
        );
        after
    }

    /// Classify a write response under the write retry policy.
    async fn settle_write(
        &self,
        send: Result<reqwest::Response, reqwest::Error>,
        attempt: u32,
        probe: bool,
    ) -> WriteStep {
        let resp = match send {
            Ok(resp) => resp,
            Err(e) => return WriteStep::Done(Err(NetError::Transport(e.to_string()))),
        };
        let status = resp.status();
        let budget = parse_budget(resp.headers());

        if status.is_success() {
            self.note_success(&budget);
            // The status says the server applied the write. A body that breaks
            // off after it loses only the answer's detail, and reporting a
            // transport failure would have the caller send the write again.
            let body = match resp.bytes().await {
                Ok(bytes) => bytes.to_vec(),
                Err(e) => {
                    log::warn!("veloqrs: [transport] a write landed but its answer broke off: {e}");
                    Vec::new()
                }
            };
            return WriteStep::Done(Ok(body));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return WriteStep::Done(Err(NetError::Unauthorized));
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            if let AfterRefusal::Cooldown { until } = self.note_refusal(resp, &budget, probe).await
            {
                return WriteStep::Done(Err(NetError::Deferred { until }));
            }
            if attempt >= MAX_RETRIES {
                return WriteStep::Done(Err(NetError::RateLimited));
            }
            return WriteStep::Backoff(governor::decide_backoff(
                budget.retry_after_secs,
                attempt + 1,
                true,
                self.governor.jitter(),
            ));
        }
        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();
        WriteStep::Done(Err(NetError::Http { status: code, body }))
    }
}

/// The error for a request whose governor wait used up its lane's budget
/// before anything was sent.
fn budget_spent() -> NetError {
    NetError::Transport("the request budget ran out waiting for a dispatch slot".to_string())
}

/// What a write response asks the caller to do next.
enum WriteStep {
    Done(Result<Vec<u8>, NetError>),
    Backoff(Duration),
}

/// A file part sourced from a path on the device rather than from memory.
pub struct FilePart<'a> {
    /// Multipart field name the server expects.
    pub field: &'a str,
    /// Where the file sits on the device. A `file://` URI is accepted, since
    /// that is the form the app's storage layer hands around.
    pub path: &'a str,
    /// The filename recorded against the upload.
    pub filename: &'a str,
}

/// Open a file part and wrap it as a length-known stream. The length keeps the
/// request on `Content-Length` rather than chunked encoding.
async fn streamed_file_part(file: &FilePart<'_>) -> Result<reqwest::multipart::Part, NetError> {
    let path = strip_file_scheme(file.path);
    let handle = tokio::fs::File::open(path)
        .await
        .map_err(|e| NetError::Io(format!("cannot open {}: {}", path, e)))?;
    let len = handle
        .metadata()
        .await
        .map_err(|e| NetError::Io(format!("cannot size {}: {}", path, e)))?
        .len();
    let body = reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(handle));
    reqwest::multipart::Part::stream_with_length(body, len)
        .file_name(file.filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| NetError::Io(e.to_string()))
}

/// Drop a `file://` scheme so an app storage URI opens as a filesystem path.
/// No percent-decoding: the paths that reach here are generated ids under the
/// app's own document directory, never user-typed text.
pub(crate) fn strip_file_scheme(path: &str) -> &str {
    path.strip_prefix("file://").unwrap_or(path)
}

/// `Retry-After` and the `X-RateLimit-*` pair, whichever a response carries.
fn parse_budget(headers: &reqwest::header::HeaderMap) -> RateBudget {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    governor::parse_rate_headers(
        header("retry-after"),
        header("x-ratelimit-limit"),
        header("x-ratelimit-remaining"),
    )
}

/// How much of a refused response's body is logged.
const REFUSAL_BODY_LOG_BYTES: usize = 200;

/// One log line describing a refused response: the status, every header and
/// the start of the body. A cookie's value is withheld.
fn refusal_record(status: u16, headers: &reqwest::header::HeaderMap, body: &[u8]) -> String {
    let headers = headers
        .iter()
        .map(|(name, value)| {
            let value = if name == reqwest::header::SET_COOKIE {
                "<withheld>".into()
            } else {
                String::from_utf8_lossy(value.as_bytes())
            };
            format!("{name}: {value}")
        })
        .collect::<Vec<_>>()
        .join("; ");
    let body = String::from_utf8_lossy(&body[..body.len().min(REFUSAL_BODY_LOG_BYTES)]);
    format!("status {status}, headers [{headers}], body {body:?}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::NoopPolicy;
    use httpmock::prelude::*;
    use serde_json::json;

    fn fast_transport(base: String, auth: AuthMethod<'_>) -> Transport {
        // A throwaway 1000 req/s governor keeps request-path tests fast and
        // isolated from the shared 8 req/s process governor.
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_governor(base, auth, gov).unwrap()
    }

    #[test]
    fn sends_basic_auth_and_parses_json() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/athlete/i1").header(
                "authorization",
                governor::format_auth_header(AuthMethod::ApiKey("secret")),
            );
            then.status(200).json_body(json!({"id": "i1", "name": "x"}));
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("secret"));
        let got: serde_json::Value =
            crate::runtime::block_on(t.get_json("/athlete/i1", &[], Lane::Interactive)).unwrap();
        mock.assert();
        assert_eq!(got["id"], "i1");
    }

    #[test]
    fn sends_bearer_auth() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/me")
                .header("authorization", "Bearer tok123");
            then.status(200).json_body(json!({"id": "i1"}));
        });
        let t = fast_transport(server.base_url(), AuthMethod::Bearer("tok123"));
        let _: serde_json::Value =
            crate::runtime::block_on(t.get_json("/athlete/me", &[], Lane::Interactive)).unwrap();
        mock.assert();
    }

    #[test]
    fn forwards_query_params() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/athlete/i1/activities")
                .query_param("oldest", "2026-01-01")
                .query_param("newest", "2026-06-26");
            then.status(200).json_body(json!([]));
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let _: serde_json::Value = crate::runtime::block_on(t.get_json(
            "/athlete/i1/activities",
            &[("oldest", "2026-01-01"), ("newest", "2026-06-26")],
            Lane::Backfill,
        ))
        .unwrap();
        mock.assert();
    }

    #[test]
    fn unauthorized_maps_to_error() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(401);
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Unauthorized)));
        // 401 is terminal: credentials won't improve on retry, so dispatch once.
        assert_eq!(mock.calls(), 1);
    }

    #[test]
    fn retries_429_then_gives_up_and_honours_retry_after() {
        let server = MockServer::start();
        // Retry-After: 0 keeps the test fast while still exercising the header path.
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(429).header("retry-after", "0");
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Backfill));
        assert!(matches!(res, Err(NetError::RateLimited)));
        // 1 initial dispatch + MAX_RETRIES retries.
        assert_eq!(mock.calls(), (MAX_RETRIES + 1) as usize);
    }

    fn budgeted(base: String) -> (Transport, Arc<Governor>) {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            governor::Budget::new(0),
            None,
            || 0.0,
        ));
        let t = Transport::with_governor(base, AuthMethod::ApiKey("k"), gov.clone()).unwrap();
        (t, gov)
    }

    /// Expected behaviour: a refusal through the application with a long
    /// `Retry-After` is not retried inline. It sets the cooldown for the whole
    /// of it, the request reports a deferral rather than a failure, and the
    /// next backfill request sends nothing at all.
    #[test]
    fn a_long_retry_after_sets_the_cooldown_and_sends_nothing_more() {
        let server = MockServer::start();
        let quota = server.mock(|when, then| {
            when.method(GET).path("/quota");
            then.status(429)
                .header("retry-after", "600")
                .header("via", "1.1 Caddy")
                .body("{\"status\":429}");
        });
        let (t, gov) = budgeted(server.base_url());
        let before = chrono::Utc::now();

        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/quota", &[], Lane::Backfill));
        let Err(NetError::Deferred { until }) = res else {
            panic!("expected a deferral, got {res:?}");
        };
        assert!(until >= before + chrono::TimeDelta::seconds(600), "{until}");
        assert!(until <= chrono::Utc::now() + chrono::TimeDelta::seconds(600));
        assert_eq!(quota.calls(), 1, "a long Retry-After was retried inline");

        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/quota", &[], Lane::Backfill));
        assert!(matches!(res, Err(NetError::Deferred { until: u }) if u == until));
        let res = crate::runtime::block_on(t.post_json(
            "/quota",
            &json!({}),
            governor::Dispatch::new(Lane::Interactive, governor::Intent::Sync),
        ));
        assert!(matches!(res, Err(NetError::Deferred { .. })));
        assert_eq!(quota.calls(), 1, "a deferred request was sent");
        assert_eq!(
            gov.budget_snapshot(chrono::Utc::now())
                .unwrap()
                .cooldown_until,
            Some(until)
        );
    }

    /// Expected behaviour: an edge burst is retried inline once, and a second
    /// refusal in a row ends the retries in a cooldown, on reads and writes
    /// alike.
    #[test]
    fn an_edge_burst_is_retried_once_and_the_next_refusal_cools_down() {
        let server = MockServer::start();
        let read = server.mock(|when, then| {
            when.method(GET).path("/edge");
            then.status(429).header("retry-after", "0");
        });
        let (t, _gov) = budgeted(server.base_url());
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/edge", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Deferred { .. })), "{res:?}");
        assert_eq!(read.calls(), 2);

        let write = server.mock(|when, then| {
            when.method(POST).path("/edge");
            then.status(429).header("retry-after", "0");
        });
        let (t, _gov) = budgeted(server.base_url());
        let res = crate::runtime::block_on(t.post_json("/edge", &json!({}), Lane::Interactive));
        assert!(matches!(res, Err(NetError::Deferred { .. })), "{res:?}");
        assert_eq!(write.calls(), 2);
    }

    /// Expected behaviour: inside a cooldown a user request goes as the one
    /// probe, is not retried inline when refused, and its refusal holds every
    /// intent until the next midnight; a probe that answers ends the cooldown.
    #[test]
    fn a_probe_is_sent_once_and_its_refusal_holds_until_midnight() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/quota");
            then.status(429)
                .header("retry-after", "60")
                .header("via", "1.1 Caddy");
        });
        let probe = server.mock(|when, then| {
            when.method(GET).path("/probe");
            then.status(429).header("retry-after", "1");
        });
        let (t, gov) = budgeted(server.base_url());
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/quota", &[], Lane::Backfill));
        assert!(matches!(res, Err(NetError::Deferred { .. })));

        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/probe", &[], Lane::Interactive));
        let Err(NetError::Deferred { until }) = res else {
            panic!("expected a deferral, got {res:?}");
        };
        assert_eq!(probe.calls(), 1, "the probe was retried inline");
        let now = chrono::Utc::now();
        assert!(until > now + chrono::TimeDelta::minutes(5), "{until}");
        assert_eq!(until.time(), chrono::NaiveTime::MIN, "{until}");

        // The next user request inside five minutes is not sent.
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/probe", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Deferred { .. })));
        assert_eq!(probe.calls(), 1);

        gov.note_success(&RateBudget::default(), now);
        let ok = server.mock(|when, then| {
            when.method(GET).path("/ok");
            then.status(200).json_body(json!({}));
        });
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/ok", &[], Lane::Backfill));
        assert!(res.is_ok(), "{res:?}");
        assert_eq!(ok.calls(), 1);
    }

    /// Expected behaviour: a success whose budget pair is low holds the
    /// backfill on the governor the transport shares, and sends nothing for
    /// it, while a user request still goes.
    #[test]
    fn a_low_budget_figure_holds_the_backfill_and_not_the_user() {
        let server = MockServer::start();
        let low = server.mock(|when, then| {
            when.method(GET).path("/low");
            then.status(200)
                .header("x-ratelimit-limit", "2500,8000")
                .header("x-ratelimit-remaining", "300,6000")
                .json_body(json!({}));
        });
        let (t, _gov) = budgeted(server.base_url());
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/low", &[], Lane::Interactive));
        assert!(res.is_ok());
        let now = chrono::Utc::now();
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/low", &[], Lane::Backfill));
        let Err(NetError::Deferred { until }) = res else {
            panic!("expected a deferral, got {res:?}");
        };
        assert!(until > now && until <= chrono::Utc::now() + chrono::TimeDelta::minutes(15));
        assert_eq!(low.calls(), 1);
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/low", &[], Lane::Interactive));
        assert!(res.is_ok());
        assert_eq!(low.calls(), 2);
    }

    #[test]
    fn a_refusal_record_carries_every_header_and_the_start_of_the_body() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after", "370".parse().unwrap());
        headers.insert("via", "1.1 Caddy".parse().unwrap());
        headers.insert("set-cookie", "session=private".parse().unwrap());
        let body = "x".repeat(500);
        let record = refusal_record(429, &headers, body.as_bytes());
        assert!(record.contains("429"), "{record}");
        assert!(record.contains("retry-after: 370"), "{record}");
        assert!(record.contains("via: 1.1 Caddy"), "{record}");
        assert!(
            !record.contains("private"),
            "a cookie value is never logged: {record}"
        );
        assert!(record.contains(&"x".repeat(REFUSAL_BODY_LOG_BYTES)));
        assert!(!record.contains(&"x".repeat(REFUSAL_BODY_LOG_BYTES + 1)));

        let empty = refusal_record(429, &reqwest::header::HeaderMap::new(), b"");
        assert!(empty.contains("429"), "{empty}");
    }

    #[test]
    fn retries_5xx_then_returns_http_error() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/y");
            then.status(503);
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/y", &[], Lane::Interactive));
        // A 5xx is retried with exponential backoff, then surfaced as Http once
        // the retry budget is exhausted (httpmock 0.7 can't sequence a transient
        // 503-then-200, so the give-up path is what we can assert deterministically).
        assert!(matches!(res, Err(NetError::Http { status: 503, .. })));
        assert_eq!(mock.calls(), (MAX_RETRIES + 1) as usize);
    }

    #[test]
    fn decode_error_on_bad_shape() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/z");
            then.status(200).body("not json");
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/z", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::Decode(_))));
    }

    #[test]
    fn each_dispatch_passes_through_the_governor() {
        let _clock = crate::test_globals::real_clock();
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/p");
            then.status(200).json_body(json!({"ok": true}));
        });
        // A deliberately slow 4 req/s governor (250ms/slot): the second request
        // can only fire after waiting a slot, which proves the transport acquires
        // the shared governor before dispatch rather than sending immediately.
        let gov = Arc::new(Governor::new(4, Box::new(NoopPolicy)));
        let t = Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), gov).unwrap();
        let start = std::time::Instant::now();
        let _: serde_json::Value =
            crate::runtime::block_on(t.get_json("/p", &[], Lane::Interactive)).unwrap();
        let _: serde_json::Value =
            crate::runtime::block_on(t.get_json("/p", &[], Lane::Interactive)).unwrap();
        assert!(
            start.elapsed() >= Duration::from_millis(240),
            "second dispatch was not paced by the governor: {:?}",
            start.elapsed()
        );
        assert_eq!(mock.calls(), 2);
    }

    #[test]
    fn drops_the_file_scheme_from_a_storage_uri() {
        assert_eq!(
            strip_file_scheme("file:///data/rec/1.fit"),
            "/data/rec/1.fit"
        );
        assert_eq!(strip_file_scheme("/data/rec/1.fit"), "/data/rec/1.fit");
    }

    /// A FIT file on disk, plus the handle that keeps it alive for the test.
    fn staged_fit() -> (tempfile::NamedTempFile, String) {
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[0x0e, 0x20, 0x00, 0x00, 0x2e, 0x46, 0x49, 0x54])
            .unwrap();
        f.flush().unwrap();
        let path = f.path().to_string_lossy().into_owned();
        (f, path)
    }

    fn upload_parts() -> Vec<(&'static str, String)> {
        vec![
            ("name", "Bern loop".to_string()),
            ("paired_event_id", "4321".to_string()),
            ("device_name", "Veloq".to_string()),
        ]
    }

    #[test]
    fn multipart_streams_the_file_and_names_every_part() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .header(
                    "authorization",
                    governor::format_auth_header(AuthMethod::ApiKey("k")),
                )
                // The field names intervals.icu expects. A rename here silently
                // loses the activity, so each part is asserted by name.
                .body_includes("name=\"file\"")
                .body_includes("filename=\"Morning Ride.fit\"")
                .body_includes("name=\"name\"")
                .body_includes("Bern loop")
                .body_includes("name=\"paired_event_id\"")
                .body_includes("4321")
                .body_includes("name=\"device_name\"")
                .body_includes("Veloq")
                // The streamed bytes arrive intact.
                .body_includes(".FIT");
            then.status(200).json_body(json!({"id": "i999"}));
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "Morning Ride.fit",
        };
        let body = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &upload_parts(),
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ))
        .unwrap();
        mock.assert();
        assert!(String::from_utf8_lossy(&body).contains("i999"));
    }

    #[test]
    fn multipart_accepts_a_file_scheme_path() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(200).json_body(json!({"id": "i999"}));
        });

        let (_file, path) = staged_fit();
        let uri = format!("file://{}", path);
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &uri,
            filename: "ride.fit",
        };
        crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ))
        .unwrap();
        mock.assert();
    }

    #[test]
    fn multipart_403_surfaces_once_with_its_body() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(403)
                .json_body(json!({"error": "No permission"}));
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &upload_parts(),
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        match res {
            Err(NetError::Http { status, body }) => {
                assert_eq!(status, 403);
                assert!(body.contains("No permission"));
            }
            other => panic!("expected a 403, got {:?}", other),
        }
        // A rejected upload is dispatched once: the queue owns the retry.
        assert_eq!(mock.calls(), 1);
    }

    #[test]
    fn multipart_429_honours_retry_after_then_gives_up() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(429).header("retry-after", "0");
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &upload_parts(),
            &[],
            Lane::Backfill,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::RateLimited)));
        // A 429 was refused outright, so re-sending cannot duplicate anything.
        assert_eq!(mock.calls(), (MAX_RETRIES + 1) as usize);
    }

    #[test]
    fn multipart_5xx_is_not_retried() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(503);
        });

        let (_file, path) = staged_fit();
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::Http { status: 503, .. })));
        // The server may have applied the write before failing, so a blind
        // resend could double-post. One dispatch, then surface.
        assert_eq!(mock.calls(), 1);
    }

    #[test]
    fn multipart_transport_failure_surfaces_immediately() {
        let (_file, path) = staged_fit();
        let t = fast_transport("http://127.0.0.1:1".to_string(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::Transport(_))));
    }

    #[test]
    fn a_missing_file_is_an_io_error_not_a_network_one() {
        // Misreading this as a network failure would queue the upload forever
        // against a file that will never appear.
        let t = fast_transport("http://127.0.0.1:1".to_string(), AuthMethod::ApiKey("k"));
        let part = FilePart {
            field: "file",
            path: "/nonexistent/ride.fit",
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &[],
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::Io(_))));
    }

    #[test]
    fn post_json_sends_the_body_and_returns_the_response() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/athlete/i1/activities")
                .header("authorization", "Bearer tok")
                .json_body(json!({"name": "Yoga", "trainer": false}));
            then.status(200).json_body(json!({"id": "i77"}));
        });
        let t = fast_transport(server.base_url(), AuthMethod::Bearer("tok"));
        let body = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities",
            &json!({"name": "Yoga", "trainer": false}),
            Lane::Interactive,
        ))
        .unwrap();
        mock.assert();
        assert!(String::from_utf8_lossy(&body).contains("i77"));
    }

    #[test]
    fn post_json_401_is_terminal() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(401);
        });
        let t = fast_transport(server.base_url(), AuthMethod::ApiKey("k"));
        let res = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities",
            &json!({}),
            Lane::Interactive,
        ));
        assert!(matches!(res, Err(NetError::Unauthorized)));
        assert_eq!(mock.calls(), 1);
    }

    /// Scenario: the server answers a create with 200 and a length it never
    /// delivers, the connection closing partway through the body.
    /// Expected behaviour: the write is reported landed with an empty answer,
    /// once, rather than as a transport failure the caller would send again.
    #[test]
    fn a_write_whose_answer_breaks_off_after_a_200_is_landed() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = hits.clone();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                      Content-Length: 400\r\n\r\n{\"id\":\"i7",
                );
                let _ = stream.flush();
            }
        });
        let t = transport_to(addr, brisk_timeouts());

        let res = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities/manual",
            &json!({}),
            Lane::Interactive,
        ));

        assert!(matches!(&res, Ok(body) if body.is_empty()), "{res:?}");
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    /// A socket that completes the TCP handshake and then never answers. This
    /// is the captive portal and the hotel wifi, and it is the case a bare
    /// total timeout handles worst.
    struct HangingSocket {
        addr: std::net::SocketAddr,
        connections: Arc<std::sync::atomic::AtomicUsize>,
    }

    fn hanging_socket() -> HangingSocket {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = connections.clone();
        std::thread::spawn(move || {
            // Accepted streams are parked, never read and never written, so the
            // client sees a live connection that produces no response.
            let mut parked = Vec::new();
            for stream in listener.incoming().flatten() {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                parked.push(stream);
            }
        });
        HangingSocket { addr, connections }
    }

    fn brisk_timeouts() -> LaneTimeouts {
        LaneTimeouts {
            connect: Duration::from_millis(200),
            interactive: Duration::from_millis(300),
            backfill: Duration::from_millis(300),
            interactive_budget: Duration::from_millis(400),
        }
    }

    fn transport_to(addr: std::net::SocketAddr, timeouts: LaneTimeouts) -> Transport {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        Transport::with_timeouts(
            format!("http://{}", addr),
            AuthMethod::ApiKey("k"),
            gov,
            timeouts,
        )
        .unwrap()
    }

    #[test]
    fn a_hanging_socket_costs_the_interactive_lane_one_attempt_not_four() {
        let socket = hanging_socket();
        let t = transport_to(socket.addr, brisk_timeouts());
        // The socket never answers, so a request with no ceiling on its
        // attempt never returns. How much of the budget an attempt may take is
        // `an_attempt_never_gets_more_than_the_budget_has_left`.
        let res: Result<serde_json::Value, _> = crate::test_globals::returns_within(
            Duration::from_secs(60),
            "the interactive request to a socket that hangs",
            move || crate::runtime::block_on(t.get_json("/x", &[], Lane::Interactive)),
        );
        assert!(matches!(res, Err(NetError::Transport(_))), "{:?}", res);
        assert_eq!(
            socket.connections.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "a lane a user waits on must not spend its retries on a socket that hangs"
        );
    }

    #[test]
    fn the_backfill_lane_still_spends_every_retry_on_a_hanging_socket() {
        // Backfill has no user waiting on it, so the retry budget is the point.
        let socket = hanging_socket();
        let t = transport_to(socket.addr, brisk_timeouts());
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Backfill));
        assert!(matches!(res, Err(NetError::Transport(_))), "{:?}", res);
        assert_eq!(
            socket.connections.load(std::sync::atomic::Ordering::SeqCst),
            (MAX_RETRIES + 1) as usize
        );
    }

    #[test]
    fn a_repeated_429_stops_at_the_interactive_budget() {
        // Retry-After is honoured, but not past what the waiting user is owed.
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(429).header("retry-after", "1");
        });
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let t = Transport::with_timeouts(
            server.base_url(),
            AuthMethod::ApiKey("k"),
            gov,
            brisk_timeouts(),
        )
        .unwrap();
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/x", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::RateLimited)));
        assert_eq!(
            mock.calls(),
            1,
            "a 1s Retry-After does not fit a 400ms budget"
        );
    }

    #[test]
    fn a_5xx_run_stops_at_the_interactive_budget() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/y");
            then.status(503);
        });
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let t = Transport::with_timeouts(
            server.base_url(),
            AuthMethod::ApiKey("k"),
            gov,
            brisk_timeouts(),
        )
        .unwrap();
        let res: Result<serde_json::Value, _> =
            crate::runtime::block_on(t.get_json("/y", &[], Lane::Interactive));
        // The 503 comes back at once, so the attempt is not what runs out: the
        // 400ms backoff no longer fits the 400ms budget, so the error surfaces
        // instead of being retried into a wait the user is still sitting in.
        assert!(
            matches!(res, Err(NetError::Http { status: 503, .. })),
            "{:?}",
            res
        );
        assert_eq!(mock.calls(), 1);
    }

    /// A budget of 800 ms on a governor that paces one dispatch a second, so
    /// the second slot is always claimed after the budget has run out.
    fn slow_governor_transport(base: String) -> (Transport, Arc<Governor>) {
        let gov = Arc::new(Governor::new(1, Box::new(NoopPolicy)));
        let timeouts = LaneTimeouts {
            connect: Duration::from_millis(200),
            interactive: Duration::from_millis(800),
            backfill: Duration::from_millis(800),
            interactive_budget: Duration::from_millis(800),
        };
        let t =
            Transport::with_timeouts(base, AuthMethod::ApiKey("k"), gov.clone(), timeouts).unwrap();
        (t, gov)
    }

    #[test]
    fn a_retry_whose_governor_wait_spends_the_budget_keeps_the_503() {
        let _clock = crate::test_globals::real_clock();
        // The 400 ms backoff fits the 800 ms budget, but the governor's next
        // slot is a second out. Dispatching then would go with a zero timeout,
        // send nothing, and report a network failure in place of the 503.
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/y");
            then.status(503).body("maintenance");
        });
        let (t, _gov) = slow_governor_transport(server.base_url());
        let res = crate::runtime::block_on(t.get_bytes("/y", &[], Lane::Interactive));
        match res {
            Err(NetError::Http { status, body }) => {
                assert_eq!(status, 503);
                assert_eq!(body, "maintenance");
            }
            other => panic!("expected the 503, got {:?}", other),
        }
        assert_eq!(mock.calls(), 1);
    }

    #[test]
    fn a_429_retry_whose_governor_wait_spends_the_budget_is_rate_limited() {
        let _clock = crate::test_globals::real_clock();
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(429).header("retry-after", "0");
        });
        let (t, _gov) = slow_governor_transport(server.base_url());
        let res = crate::runtime::block_on(t.get_bytes("/x", &[], Lane::Interactive));
        assert!(matches!(res, Err(NetError::RateLimited)), "{:?}", res);
        assert_eq!(mock.calls(), 1);
    }

    #[test]
    fn a_first_attempt_queued_past_the_budget_is_never_sent() {
        let _clock = crate::test_globals::real_clock();
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/x");
            then.status(200).body("{}");
        });
        let (t, gov) = slow_governor_transport(server.base_url());
        let res = crate::runtime::block_on(async {
            // Another request takes the slot now, so this one's is a second out.
            gov.acquire(Lane::Interactive).await;
            t.get_bytes("/x", &[], Lane::Interactive).await
        });
        match res {
            Err(NetError::Transport(msg)) => assert!(msg.contains("budget"), "{}", msg),
            other => panic!("expected a spent budget, got {:?}", other),
        }
        assert_eq!(mock.calls(), 0);
    }

    #[test]
    fn a_post_retry_whose_governor_wait_spends_the_budget_is_rate_limited() {
        let _clock = crate::test_globals::real_clock();
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(429).header("retry-after", "0");
        });
        let (t, _gov) = slow_governor_transport(server.base_url());
        let res = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities",
            &json!({}),
            Lane::Interactive,
        ));
        assert!(matches!(res, Err(NetError::RateLimited)), "{:?}", res);
        assert_eq!(mock.calls(), 1);
    }

    /// A budget of 1010 ms on a governor that paces one dispatch a second, so
    /// a retry whose backoff fits is claimed with about 10 ms left to run in.
    fn nearly_spent_transport(base: String) -> Transport {
        let gov = Arc::new(Governor::new(1, Box::new(NoopPolicy)));
        let timeouts = LaneTimeouts {
            connect: Duration::from_millis(200),
            interactive: Duration::from_millis(1010),
            backfill: Duration::from_millis(1010),
            interactive_budget: Duration::from_millis(1010),
        };
        Transport::with_timeouts(base, AuthMethod::ApiKey("k"), gov, timeouts).unwrap()
    }

    #[test]
    fn a_retry_left_a_sliver_of_budget_keeps_the_503() {
        // The 503 lands at 200 ms and its 400 ms backoff fits, but the
        // governor's next slot is at 1000 ms. The retry goes out with 10 ms,
        // times out, and must not trade the 503 for that timeout.
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/y");
            then.status(503)
                .body("maintenance")
                .delay(Duration::from_millis(200));
        });
        let t = nearly_spent_transport(server.base_url());
        let res = crate::runtime::block_on(t.get_bytes("/y", &[], Lane::Interactive));
        match res {
            Err(NetError::Http { status, body }) => {
                assert_eq!(status, 503);
                assert_eq!(body, "maintenance");
            }
            other => panic!("expected the 503, got {:?}", other),
        }
        assert_eq!(mock.calls(), 2);
    }

    #[test]
    fn a_post_retry_left_a_sliver_of_budget_is_rate_limited() {
        let _clock = crate::test_globals::real_clock();
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(429)
                .header("retry-after", "0")
                .delay(Duration::from_millis(200));
        });
        let t = nearly_spent_transport(server.base_url());
        let res = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities",
            &json!({}),
            Lane::Interactive,
        ));
        assert!(matches!(res, Err(NetError::RateLimited)), "{:?}", res);
        assert_eq!(mock.calls(), 2);
    }

    #[test]
    fn a_first_attempt_that_times_out_is_still_a_transport_failure() {
        // Only a retry has an earlier answer to fall back on. A first attempt
        // that runs out of time never reached the server as far as anyone
        // knows, and the caller queues it for the network.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(200)
                .body("{}")
                .delay(Duration::from_millis(1500));
        });
        let t = nearly_spent_transport(server.base_url());
        let res = crate::runtime::block_on(t.post_json(
            "/athlete/i1/activities",
            &json!({}),
            Lane::Interactive,
        ));
        assert!(matches!(res, Err(NetError::Transport(_))), "{:?}", res);
    }

    #[test]
    fn a_multipart_429_stops_at_the_interactive_budget() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(429).header("retry-after", "120");
        });
        let (_file, path) = staged_fit();
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        let t = Transport::with_timeouts(
            server.base_url(),
            AuthMethod::ApiKey("k"),
            gov,
            brisk_timeouts(),
        )
        .unwrap();
        // Sleeping the two-minute backoff before giving up would outlast the
        // guard, which is half of it.
        let res = crate::test_globals::returns_within(
            Duration::from_secs(60),
            "the upload that slept a backoff the budget had no room for",
            move || {
                let part = FilePart {
                    field: "file",
                    path: &path,
                    filename: "ride.fit",
                };
                crate::runtime::block_on(t.post_multipart(
                    "/athlete/i1/activities",
                    &part,
                    &upload_parts(),
                    &[],
                    Lane::Interactive,
                    Duration::from_secs(60),
                ))
            },
        );
        assert!(matches!(res, Err(NetError::RateLimited)), "{:?}", res);
        assert_eq!(
            mock.calls(),
            1,
            "a 120 s Retry-After does not fit a 400 ms budget"
        );
    }

    #[test]
    fn a_multipart_retry_whose_governor_wait_spends_the_budget_is_rate_limited() {
        let _clock = crate::test_globals::real_clock();
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/athlete/i1/activities");
            then.status(429).header("retry-after", "0");
        });
        let (_file, path) = staged_fit();
        let (t, _gov) = slow_governor_transport(server.base_url());
        let part = FilePart {
            field: "file",
            path: &path,
            filename: "ride.fit",
        };
        let res = crate::runtime::block_on(t.post_multipart(
            "/athlete/i1/activities",
            &part,
            &upload_parts(),
            &[],
            Lane::Interactive,
            Duration::from_secs(60),
        ));
        assert!(matches!(res, Err(NetError::RateLimited)), "{:?}", res);
        assert_eq!(mock.calls(), 1);
    }

    #[test]
    fn an_attempt_never_gets_more_than_the_budget_has_left() {
        let t = LaneTimeouts::default();
        let now = Instant::now();
        assert_eq!(t.attempt_at(Lane::Interactive, now, now), t.interactive);
        // Backfill is unbudgeted, so it keeps the long ceiling however long the
        // request has already run.
        let overrun = now - (t.interactive_budget + Duration::from_secs(1));
        assert_eq!(t.attempt_at(Lane::Backfill, overrun, now), t.backfill);
        let spent = now - (t.interactive_budget - Duration::from_secs(1));
        assert_eq!(
            t.attempt_at(Lane::Interactive, spent, now),
            Duration::from_secs(1),
            "an attempt gets the second the budget has left"
        );
        assert_eq!(
            t.attempt_at(Lane::Interactive, overrun, now),
            Duration::ZERO
        );
    }

    #[test]
    fn the_shipped_timeouts_bound_what_a_user_can_be_made_to_wait() {
        let t = LaneTimeouts::default();
        assert!(
            t.connect <= Duration::from_secs(5),
            "a connect that never completes must not burn a whole attempt"
        );
        assert!(t.interactive < t.backfill);
        // The old worst case was 4 x 30s of frozen UI. Whatever the numbers
        // become, one interactive request stays inside ten seconds.
        assert!(t.interactive_budget <= Duration::from_secs(10));
        assert!(t.interactive <= t.interactive_budget);
    }
}
