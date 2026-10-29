//! Garmin's Personal API: a key the athlete pastes is exchanged for a token
//! that lives a day, the token lists activities by date and downloads the
//! original FIT of one.
//!
//! The client draws on the process governor, in its own [`Lane`], so Garmin
//! traffic is paced with the intervals.icu traffic and never beside it. The
//! key and the token are never logged or printed.

pub mod account;

pub mod endpoints;

pub mod ingest;

pub mod pull;

pub mod wire;

use crate::governor::{self, AuthMethod, Dispatch, Governor, Lane};
use crate::net::transport::{NetError, Transport};
use base64::Engine;
use chrono::{DateTime, Duration, TimeZone, Utc};
use std::sync::{Arc, Mutex};
use wire::ListedActivity;

/// How long before its expiry a token is renewed, so one never expires on the
/// way to a request.
const RENEW_BEFORE_EXPIRY: Duration = Duration::minutes(5);

/// Why a Garmin call did not answer.
#[derive(Debug)]
pub enum GarminError {
    /// Garmin answered the key with a 400: it is not a key.
    KeyMalformed,
    /// Garmin rejected the key, or rejected a token it had just issued. The
    /// connector is parked until the athlete pastes a new key; retrying
    /// changes nothing.
    KeyRejected,
    Net(NetError),
}

impl std::fmt::Display for GarminError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GarminError::KeyMalformed => write!(f, "the Garmin key is malformed (400)"),
            GarminError::KeyRejected => write!(f, "the Garmin key was rejected"),
            GarminError::Net(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for GarminError {}

impl From<NetError> for GarminError {
    fn from(e: NetError) -> Self {
        GarminError::Net(e)
    }
}

struct CachedToken {
    token: String,
    expires_at: DateTime<Utc>,
}

/// One athlete's Garmin Personal key and the token it was last exchanged for.
pub struct GarminClient {
    base_url: String,
    /// False only for a test client against a local mock.
    https_only: bool,
    key: String,
    governor: Arc<Governor>,
    cached: Mutex<Option<CachedToken>>,
}

impl std::fmt::Debug for GarminClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GarminClient")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

impl GarminClient {
    /// A client on the process governor.
    pub fn new(key: impl Into<String>) -> Self {
        Self::build(
            endpoints::BASE_URL.into(),
            true,
            key.into(),
            governor::GOVERNOR.clone(),
        )
    }

    /// A client on a specific governor and root, for tests against a local
    /// mock. Production builds only [`GarminClient::new`], so a release build
    /// cannot point the key at another host.
    #[cfg(test)]
    pub(crate) fn with_governor(
        base_url: impl Into<String>,
        key: impl Into<String>,
        governor: Arc<Governor>,
    ) -> Self {
        Self::build(base_url.into(), false, key.into(), governor)
    }

    /// A test client that holds to HTTPS as production does.
    #[cfg(test)]
    pub(crate) fn with_governor_requiring_https(
        base_url: impl Into<String>,
        key: impl Into<String>,
        governor: Arc<Governor>,
    ) -> Self {
        Self::build(base_url.into(), true, key.into(), governor)
    }

    fn build(base_url: String, https_only: bool, key: String, governor: Arc<Governor>) -> Self {
        Self {
            base_url,
            https_only,
            key,
            governor,
            cached: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub(crate) fn governor(&self) -> &Arc<Governor> {
        &self.governor
    }

    fn transport(&self, auth: AuthMethod<'_>) -> Result<Transport, NetError> {
        Transport::credentialed(
            self.base_url.clone(),
            auth,
            self.governor.clone(),
            self.https_only,
        )
        .map_err(NetError::Transport)
    }

    fn cached_token(&self) -> Option<String> {
        let now = self.governor.now();
        let cached = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        cached
            .as_ref()
            .filter(|c| c.expires_at - RENEW_BEFORE_EXPIRY > now)
            .map(|c| c.token.clone())
    }

    fn forget_token(&self) {
        *self.cached.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Exchange the key for a token and keep it.
    async fn exchange(&self, dispatch: Dispatch) -> Result<String, GarminError> {
        let t = self.transport(AuthMethod::GarminKey(&self.key))?;
        let token = match endpoints::fetch_token(&t, dispatch).await {
            Ok(token) => token,
            Err(NetError::Unauthorized) => return Err(GarminError::KeyRejected),
            Err(NetError::Http { status: 400, .. }) => return Err(GarminError::KeyMalformed),
            Err(e) => return Err(e.into()),
        };
        let expires_at = token_expiry(&token).ok_or_else(|| {
            GarminError::Net(NetError::Decode("the token carries no expiry".into()))
        })?;
        *self.cached.lock().unwrap_or_else(|e| e.into_inner()) = Some(CachedToken {
            token: token.clone(),
            expires_at,
        });
        Ok(token)
    }

    /// Run `request` with a valid token. A 401 on a cached token renews it and
    /// asks once more; a 401 on a token just issued means the key is rejected.
    async fn with_token<T, F, Fut>(&self, dispatch: Dispatch, request: F) -> Result<T, GarminError>
    where
        F: Fn(Transport) -> Fut,
        Fut: std::future::Future<Output = Result<T, NetError>>,
    {
        let (token, fresh) = match self.cached_token() {
            Some(token) => (token, false),
            None => (self.exchange(dispatch).await?, true),
        };
        let t = self.transport(AuthMethod::Bearer(&token))?;
        match request(t).await {
            Err(NetError::Unauthorized) if fresh => Err(GarminError::KeyRejected),
            Err(NetError::Unauthorized) => {
                self.forget_token();
                let token = self.exchange(dispatch).await?;
                let t = self.transport(AuthMethod::Bearer(&token))?;
                match request(t).await {
                    Err(NetError::Unauthorized) => Err(GarminError::KeyRejected),
                    other => other.map_err(Into::into),
                }
            }
            other => other.map_err(Into::into),
        }
    }

    /// Whether Garmin accepts the key: exchanges it, whatever the cache holds.
    pub async fn check_key(&self, dispatch: impl Into<Dispatch>) -> Result<(), GarminError> {
        self.exchange(dispatch.into()).await.map(|_| ())
    }

    /// Whether the key can read the account's activities: asks for one page of
    /// at most one activity in the last day, and ignores what it holds.
    pub async fn check_activity_access(
        &self,
        dispatch: impl Into<Dispatch>,
    ) -> Result<(), GarminError> {
        let dispatch = dispatch.into();
        let today = chrono::Local::now()
            .date_naive()
            .format("%Y-%m-%d")
            .to_string();
        let day = today.as_str();
        self.with_token(dispatch, |t| async move {
            endpoints::fetch_activity_page(&t, 0, 1, day, day, dispatch).await
        })
        .await
        .map(|_| ())
    }

    /// The name Garmin gives the account the key belongs to, `None` when its
    /// settings name none.
    pub async fn display_name(
        &self,
        dispatch: impl Into<Dispatch>,
    ) -> Result<Option<String>, GarminError> {
        let dispatch = dispatch.into();
        let settings = self
            .with_token(dispatch, |t| async move {
                endpoints::fetch_user_settings(&t, dispatch).await
            })
            .await?;
        Ok(account::display_name_in(&settings))
    }

    /// Every activity from `start_date` to `end_date` (local days, inclusive),
    /// paged until a page comes back short.
    pub async fn list_activities(
        &self,
        start_date: &str,
        end_date: &str,
        dispatch: impl Into<Dispatch>,
    ) -> Result<Vec<ListedActivity>, GarminError> {
        let dispatch = dispatch.into();
        let mut all = Vec::new();
        loop {
            let start = all.len();
            let page = self
                .with_token(dispatch, |t| async move {
                    endpoints::fetch_activity_page(
                        &t,
                        start,
                        endpoints::PAGE_SIZE,
                        start_date,
                        end_date,
                        dispatch,
                    )
                    .await
                })
                .await?;
            let full = page.len() >= endpoints::PAGE_SIZE;
            all.extend(page);
            if !full {
                return Ok(all);
            }
        }
    }

    /// The original FIT of one activity.
    pub async fn download_original(
        &self,
        activity_id: i64,
        dispatch: impl Into<Dispatch>,
    ) -> Result<Vec<u8>, GarminError> {
        let dispatch = dispatch.into();
        self.with_token(dispatch, |t| async move {
            endpoints::fetch_original_fit(&t, activity_id, dispatch).await
        })
        .await
    }
}

/// The dispatch a Garmin pass draws with: the Garmin lane, and the intent the
/// lane alone states.
pub fn dispatch() -> Dispatch {
    Lane::Garmin.into()
}

/// The `exp` claim of a JWT, as a time.
fn token_expiry(token: &str) -> Option<DateTime<Utc>> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Utc.timestamp_opt(claims.get("exp")?.as_i64()?, 0).single()
}

#[cfg(test)]
mod tests;
