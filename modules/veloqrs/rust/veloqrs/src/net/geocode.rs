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

use crate::persistence::geocoded_places::{PlaceCell, cached_place, store_place};
use crate::persistence::read_pool::with_read_conn;
use crate::persistence::settings::geocoding_enabled_from;
use crate::persistence::{engine_install, with_persistent_engine_blocking_for};

/// The provider's public instance. The endpoint a lookup uses is handed to
/// it, never assumed: with none, nothing is sent. This is the host that
/// configuration names today, and the one the privacy page has to name.
pub const NOMINATIM_ENDPOINT: &str = "https://nominatim.openstreetmap.org";

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

    /// The place name for a point, in `language`, or `None`.
    ///
    /// `None` without a request when geocoding is off, when the engine is
    /// closed or when there is no endpoint. A cell already answered is answered
    /// from the device. Otherwise the request waits its turn behind any other
    /// in the engine, and an answer, a place or no place, is kept. A failed
    /// request keeps nothing, so a later lookup can ask again.
    pub async fn place_name(
        &self,
        endpoint: Option<&str>,
        lat: f64,
        lng: f64,
        language: &str,
    ) -> Option<String> {
        let cell = PlaceCell::of(lat, lng);
        let install = engine_install();
        match held(cell, language)? {
            Held::Answered(name) => return name,
            Held::Owed => {}
        }
        let endpoint = endpoint?;

        let mut last_ended = LAST_REQUEST_ENDED.lock().await;
        // Read again under the pacer: the switch may have gone off while this
        // waited, or the lookup ahead of it may have answered the same cell.
        match held(cell, language)? {
            Held::Answered(name) => return name,
            Held::Owed => {}
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
                return None;
            }
            Err(e) => {
                log::warn!("veloqrs: [Geocode] {e}");
                return None;
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
        name
    }
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
