//! A place name for a point, from the one reverse geocoder the app is told to
//! use.
//!
//! The only code in the app that sends a point to a geocoder. The provider's
//! terms shape all of it: nothing is sent unless the athlete turned geocoding
//! on, every request names the app, one runs at a time with at least a second
//! between them across the whole engine, and every answer is kept so no cell
//! is asked twice. Deliberately not the intervals.icu governor, whose budget
//! belongs to the athlete's account and not to this provider.

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

/// When the last request ended, held for the whole of the next one so a
/// second lookup waits its turn. One for the engine, whichever geocoder asks.
static LAST_REQUEST_ENDED: LazyLock<tokio::sync::Mutex<Option<Instant>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));

/// A request never reached an answer.
#[derive(Debug, thiserror::Error)]
pub enum GeocodeError {
    #[error("geocoder unreachable: {0}")]
    Unreachable(String),
    #[error("geocoder answered {status}")]
    Rejected { status: u16 },
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
        let response = request
            .send()
            .await
            .map_err(|e| GeocodeError::Unreachable(e.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(GeocodeError::Rejected {
                status: status.as_u16(),
            });
        }
        response
            .text()
            .await
            .map_err(|e| GeocodeError::Unreachable(e.to_string()))
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
    /// request keeps nothing, so a later lookup can ask again.
    async fn place_name(
        &self,
        endpoint: Option<&str>,
        lat: f64,
        lng: f64,
        language: &str,
    ) -> Option<String> {
        match self.lookup(endpoint, lat, lng, language).await {
            Lookup::Place(name) => Some(name),
            Lookup::NoPlace | Lookup::NotSent | Lookup::Failed => None,
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
    /// Nothing was sent: geocoding is off, the engine is closed or there is
    /// no endpoint. Asking later may still be answered.
    NotSent,
    /// A request went out and came back with no answer.
    Failed,
}

impl Lookup {
    fn from_kept(name: Option<String>) -> Self {
        name.map_or(Self::NoPlace, Self::Place)
    }
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
