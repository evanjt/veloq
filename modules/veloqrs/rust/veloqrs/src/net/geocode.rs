//! A place name for a point, from the one reverse geocoder the app is told to
//! use.
//!
//! The only code in the app that sends a point to a geocoder. The provider's
//! terms shape all of it: nothing is sent unless the athlete turned geocoding
//! on, every request names the app, one runs at a time with at least a second
//! between them across the whole engine, every answer is kept so no cell is
//! asked twice, and a throttle, a block or a server error stops every request
//! until the wait it asked for, or a floor, has passed. Deliberately not the
//! intervals.icu governor, whose budget belongs to the athlete's account and
//! not to this provider.

use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::persistence::geocoded_places::{PlaceCell, cached_place, store_place};
use crate::persistence::read_pool::with_read_conn;
use crate::persistence::settings::{geocoding_enabled_from, setting_from, settings_keys};
use crate::persistence::{engine_install, with_persistent_engine_blocking_for};

/// The provider's public instance. The endpoint a lookup uses is handed to
/// it, never assumed: with none, nothing is sent. This is the host that
/// configuration names today, and the one the privacy page has to name.
pub const NOMINATIM_ENDPOINT: &str = "https://nominatim.openstreetmap.org";

const CONFIG_URL: &str = "https://auth.veloq.fit/geocoder";
const CONFIG_LIFETIME_MS: i64 = 86_400_000;

#[derive(Clone, Deserialize, Serialize)]
struct ConfigCopy {
    endpoint: Option<String>,
    fetched_at_ms: i64,
}

impl ConfigCopy {
    fn is_fresh(&self, now_ms: i64) -> bool {
        now_ms >= self.fetched_at_ms
            && now_ms.saturating_sub(self.fetched_at_ms) < CONFIG_LIFETIME_MS
    }
}

static CONFIG_FETCH: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Names the app, its version and where to reach its maker, which the
/// provider's terms ask every request to carry.
pub const USER_AGENT: &str = concat!("veloq/", env!("CARGO_PKG_VERSION"), " (+https://veloq.fit)");

/// The least time between the end of one request and the start of the next.
/// The provider's ceiling is one a second for every install together, so one
/// install never goes faster than that on its own.
pub const PACE: Duration = Duration::from_secs(1);

/// The address detail asked for. 14 is suburb level, which is all a place
/// name needs, and asks for no more than that of the provider.
const ZOOM: u8 = 14;

/// Address fields from the most local populated place outwards. The name is
/// the first one the answer carries.
const LOCALITY_FIELDS: &[&str] = &[
    "suburb",
    "village",
    "town",
    "hamlet",
    "city",
    "municipality",
    "county",
    "state",
];

/// How long the geocoder sends nothing after its provider throttled, blocked
/// or failed a request, when the refusal does not say how long to wait.
pub const REFUSAL_FLOOR: Duration = Duration::from_secs(15 * 60);

/// The longest a refusal holds the geocoder, whatever it asked for, so a
/// date mistyped by the provider or a clock that jumped cannot silence it
/// for good.
pub const REFUSAL_LONGEST: Duration = Duration::from_secs(24 * 60 * 60);

/// When the last request ended, held for the whole of the next one so a
/// second lookup waits its turn. One for the engine, whichever geocoder asks.
static LAST_REQUEST_ENDED: LazyLock<tokio::sync::Mutex<Option<Instant>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));

/// A request never reached an answer.
#[derive(Debug, thiserror::Error)]
pub enum GeocodeError {
    /// The network is absent: no connection, a name or connect failure, or a
    /// timeout. Asking again once the device is back online may be answered.
    #[error("geocoder unreachable: {0}")]
    Unreachable(String),
    /// The provider answered with an HTTP error, and with how long it asked
    /// to be left alone when it said.
    #[error("geocoder answered {status}")]
    Rejected {
        status: u16,
        retry_after: Option<Duration>,
    },
    /// The provider was reached and the exchange broke for another reason.
    #[error("geocoder request failed: {0}")]
    Broken(String),
}

impl GeocodeError {
    fn from_transport(e: reqwest::Error) -> Self {
        if e.is_connect() || e.is_timeout() {
            Self::Unreachable(e.to_string())
        } else {
            Self::Broken(e.to_string())
        }
    }
}

/// How a request reaches the provider: the body of a GET, sent with the
/// language the answer should be in.
pub trait GeocodeTransport: Send + Sync {
    fn get(
        &self,
        url: &str,
        language: &str,
    ) -> impl Future<Output = Result<String, GeocodeError>> + Send;
}

/// The transport the app uses, a `reqwest` client of its own.
#[derive(Debug)]
pub struct HttpTransport {
    client: reqwest::Client,
}

impl HttpTransport {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("geocoder client: {}", e))?;
        Ok(Self { client })
    }
}

impl GeocodeTransport for HttpTransport {
    async fn get(&self, url: &str, language: &str) -> Result<String, GeocodeError> {
        let mut request = self.client.get(url);
        if !language.is_empty() {
            request = request.header(reqwest::header::ACCEPT_LANGUAGE, language);
        }
        let response = request.send().await.map_err(GeocodeError::from_transport)?;
        let status = response.status();
        if !status.is_success() {
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| retry_after_of(value, crate::persistence::attempts::now_ms()));
            return Err(GeocodeError::Rejected {
                status: status.as_u16(),
                retry_after,
            });
        }
        response.text().await.map_err(GeocodeError::from_transport)
    }
}

/// The reverse geocoder.
pub struct Geocoder<T = HttpTransport> {
    transport: T,
}

impl Geocoder<HttpTransport> {
    pub fn new() -> Result<Self, String> {
        Ok(Self::with_transport(HttpTransport::new()?))
    }
}

impl<T: GeocodeTransport> Geocoder<T> {
    pub fn with_transport(transport: T) -> Self {
        Self { transport }
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }

    /// Resolve the current worker configuration before sending a point.
    pub async fn configured_place_name(
        &self,
        lat: f64,
        lng: f64,
        language: &str,
    ) -> Option<String> {
        let install = engine_install();
        match held(PlaceCell::of(lat, lng), language)? {
            Held::Answered(name) => return name,
            Held::Owed => {}
        }
        let endpoint = self.configured_endpoint().await;
        if engine_install() != install {
            return None;
        }
        self.place_name(endpoint.as_deref(), lat, lng, language)
            .await
    }

    /// The served endpoint for a run of lookups, or none when it says stop.
    pub async fn configured_endpoint(&self) -> Option<String> {
        let install = engine_install();
        let previous = held_config();
        if let Some(copy) = &previous
            && copy.is_fresh(crate::persistence::attempts::now_ms())
        {
            return copy.endpoint.clone();
        }
        let _guard = CONFIG_FETCH.lock().await;
        let previous = held_config();
        if let Some(copy) = &previous
            && copy.is_fresh(crate::persistence::attempts::now_ms())
        {
            return copy.endpoint.clone();
        }
        self.refresh_config(install, previous).await
    }

    async fn refresh_config(&self, install: u64, previous: Option<ConfigCopy>) -> Option<String> {
        let Ok(body) = self.transport.get(CONFIG_URL, "").await else {
            return previous.and_then(|copy| copy.endpoint);
        };
        let Some(endpoint) = parse_endpoint(&body) else {
            return previous.and_then(|copy| copy.endpoint);
        };
        let copy = ConfigCopy {
            endpoint,
            fetched_at_ms: crate::persistence::attempts::now_ms(),
        };
        let json = serde_json::to_string(&copy).ok()?;
        let stored = with_persistent_engine_blocking_for(install, move |engine| {
            engine.set_setting(settings_keys::GEOCODER_CONFIG, &json)
        })
        .await;
        match stored {
            Some(Ok(())) => copy.endpoint,
            Some(Err(_)) => previous.and_then(|copy| copy.endpoint),
            None => None,
        }
    }

    /// The place name for a point, in `language`, or `None`.
    ///
    /// `None` without a request when geocoding is off, when the engine is
    /// closed or when there is no endpoint. A cell already answered is answered
    /// from the device. Otherwise the request waits its turn behind any other
    /// in the engine, and an answer, a place or no place, is kept. A failed
    /// request keeps nothing, so a later lookup can ask again, and a refused
    /// one holds every lookup that would send until its cool-down ends.
    async fn place_name(
        &self,
        endpoint: Option<&str>,
        lat: f64,
        lng: f64,
        language: &str,
    ) -> Option<String> {
        match self.lookup(endpoint, lat, lng, language).await {
            Lookup::Place(name) => Some(name),
            Lookup::NoPlace | Lookup::NotSent | Lookup::Refused | Lookup::Failed => None,
        }
    }

    /// What asking for a point came to, telling a lookup that was never sent
    /// from one that was answered without a place or failed on the way, which
    /// a caller that names things has to treat differently. The rules are
    /// [`Self::place_name`]'s.
    pub async fn lookup(
        &self,
        endpoint: Option<&str>,
        lat: f64,
        lng: f64,
        language: &str,
    ) -> Lookup {
        let cell = PlaceCell::of(lat, lng);
        let install = engine_install();
        match held(cell, language) {
            None => return Lookup::NotSent,
            Some(Held::Answered(name)) => return Lookup::from_kept(name),
            Some(Held::Owed) => {}
        }
        let Some(endpoint) = endpoint else {
            return Lookup::NotSent;
        };

        let mut last_ended = LAST_REQUEST_ENDED.lock().await;
        // Read again under the pacer: the switch may have gone off while this
        // waited, or the lookup ahead of it may have answered the same cell.
        match held(cell, language) {
            None => return Lookup::NotSent,
            Some(Held::Answered(name)) => return Lookup::from_kept(name),
            Some(Held::Owed) => {}
        }
        // Read under the pacer too, so a lookup that waited behind a refused
        // one sends nothing.
        let now_ms = crate::persistence::attempts::now_ms();
        if with_read_conn(|conn| refused_at(conn, now_ms)).flatten() != Some(false) {
            return Lookup::Refused;
        }
        if let Some(ended) = *last_ended {
            tokio::time::sleep_until((ended + PACE).into()).await;
        }
        let (lat, lng) = cell.centre();
        let url = format!(
            "{}/reverse?format=jsonv2&lat={lat:.3}&lon={lng:.3}&zoom={ZOOM}&addressdetails=1",
            endpoint.trim_end_matches('/'),
        );
        // Stamped before as well as after, so a lookup dropped mid-request
        // still spaces the next one from when this one went out.
        *last_ended = Some(Instant::now());
        let answer = self.transport.get(&url, language).await;
        *last_ended = Some(Instant::now());

        let name = match answer.map(|body| answer_of(&body)) {
            Ok(Some(name)) => name,
            Ok(None) => {
                log::warn!("veloqrs: [Geocode] the answer was not an address");
                return Lookup::Failed;
            }
            Err(e @ GeocodeError::Unreachable(_)) => {
                log::warn!("veloqrs: [Geocode] {e}");
                return Lookup::NotSent;
            }
            Err(
                e @ GeocodeError::Rejected {
                    status,
                    retry_after,
                },
            ) => {
                log::warn!("veloqrs: [Geocode] {e}");
                let now_ms = crate::persistence::attempts::now_ms();
                let Some(until) = refusal_ends_at(status, retry_after, now_ms) else {
                    return Lookup::Failed;
                };
                // Kept before the pacer is let go, so a lookup waiting behind
                // this one finds the refusal rather than asking.
                let held = with_persistent_engine_blocking_for(install, move |engine| {
                    engine.set_setting(settings_keys::GEOCODER_REFUSED_UNTIL, &until.to_string())
                })
                .await;
                if let Some(Err(e)) = held {
                    log::warn!("veloqrs: [Geocode] keeping a refusal: {e}");
                }
                return Lookup::Refused;
            }
            Err(e) => {
                log::warn!("veloqrs: [Geocode] {e}");
                return Lookup::Failed;
            }
        };
        let language = language.to_string();
        let kept = name.clone();
        // Kept before the pacer is let go, so a lookup waiting on the same
        // cell finds the answer rather than asking again.
        let stored = with_persistent_engine_blocking_for(install, move |engine| {
            store_place(
                &engine.db,
                cell,
                &language,
                kept.as_deref(),
                crate::persistence::attempts::now_ms(),
            )
        })
        .await;
        if let Some(Err(e)) = stored {
            log::warn!("veloqrs: [Geocode] keeping an answer: {e}");
        }
        drop(last_ended);
        Lookup::from_kept(name)
    }
}

/// What one lookup came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Lookup {
    /// The point is in this place.
    Place(String),
    /// The provider answered and the answer named no place.
    NoPlace,
    /// Nothing reached the provider: geocoding is off, the engine is closed,
    /// there is no endpoint, or the network was absent. Asking later may
    /// still be answered.
    NotSent,
    /// The provider throttled, blocked or failed this request or one before
    /// it whose cool-down has not ended. Nothing more is sent until it ends,
    /// and asking then may be answered.
    Refused,
    /// A request reached the provider and came back with no answer: an HTTP
    /// error that is not a refusal, or an answer that is not an address.
    Failed,
}

impl Lookup {
    fn from_kept(name: Option<String>) -> Self {
        name.map_or(Self::NoPlace, Self::Place)
    }
}

/// When a lookup the provider answered with `status` may next send, in epoch
/// milliseconds, or `None` when that status is an answer rather than a
/// refusal. A throttle (429), a block (403) and a server error (5xx) are
/// refusals: they hold for what the provider asked, else for
/// [`REFUSAL_FLOOR`], and never longer than [`REFUSAL_LONGEST`].
pub fn refusal_ends_at(status: u16, retry_after: Option<Duration>, now_ms: i64) -> Option<i64> {
    if !matches!(status, 403 | 429 | 500..=599) {
        return None;
    }
    let wait = retry_after.unwrap_or(REFUSAL_FLOOR).min(REFUSAL_LONGEST);
    Some(now_ms.saturating_add(i64::try_from(wait.as_millis()).unwrap_or(i64::MAX)))
}

/// The wait a `Retry-After` value asks for: a count of seconds, or an HTTP
/// date measured from `now_ms`. A date already past asks for none.
pub fn retry_after_of(value: &str, now_ms: i64) -> Option<Duration> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let at = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let wait_ms = at.timestamp_millis().saturating_sub(now_ms).max(0);
    Some(Duration::from_millis(u64::try_from(wait_ms).unwrap_or(0)))
}

/// Whether a refusal still holds the geocoder at `now_ms`, or `None` when
/// the setting could not be read. A held moment further off than the longest
/// refusal was written by a clock that has since moved back, and holds nothing.
fn refused_at(conn: &rusqlite::Connection, now_ms: i64) -> Option<bool> {
    let longest = i64::try_from(REFUSAL_LONGEST.as_millis()).unwrap_or(i64::MAX);
    let held = setting_from(conn, settings_keys::GEOCODER_REFUSED_UNTIL)
        .map_err(|e| log::warn!("veloqrs: [Geocode] reading the refusal: {e}"))
        .ok()?;
    Some(
        held.and_then(|raw| raw.parse::<i64>().ok())
            .is_some_and(|until| now_ms < until && until - now_ms <= longest),
    )
}

fn held_config() -> Option<ConfigCopy> {
    with_read_conn(|conn| {
        setting_from(conn, settings_keys::GEOCODER_CONFIG)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str(&raw).ok())
    })
    .flatten()
}

fn parse_endpoint(body: &str) -> Option<Option<String>> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let endpoint = value.get("endpoint")?;
    if endpoint.is_null() {
        return Some(None);
    }
    let endpoint = endpoint.as_str()?;
    let url = reqwest::Url::parse(endpoint).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(Some(endpoint.trim_end_matches('/').to_string()))
}

enum Held {
    Answered(Option<String>),
    Owed,
}

/// What the device holds for a cell, or `None` when nothing may be sent: the
/// switch is off or there is no library to read it from.
fn held(cell: PlaceCell, language: &str) -> Option<Held> {
    with_read_conn(|conn| {
        if !geocoding_enabled_from(conn) {
            return None;
        }
        match cached_place(conn, cell, language) {
            Ok(Some(name)) => Some(Held::Answered(name)),
            Ok(None) => Some(Held::Owed),
            Err(e) => {
                log::warn!("veloqrs: [Geocode] reading the kept answers: {e}");
                None
            }
        }
    })
    .flatten()
}

/// The place an answer names: `Some(None)` for an answer that names none,
/// `None` for a body that is not an answer at all.
fn answer_of(body: &str) -> Option<Option<String>> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let object = value.as_object()?;
    let address = object.get("address").and_then(|a| a.as_object());
    Some(address.and_then(|address| {
        LOCALITY_FIELDS.iter().find_map(|field| {
            address
                .get(*field)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
    }))
}

/// The locality an answer names, if it names one.
pub fn locality_of(body: &str) -> Option<String> {
    answer_of(body).flatten()
}

#[cfg(test)]
#[path = "tests/geocode.rs"]
mod tests;
