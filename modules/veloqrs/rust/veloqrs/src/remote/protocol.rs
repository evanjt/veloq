//! What a linked browser may ask, and the answer to each ask.
//!
//! A request is `{"id": n, "method": "...", "params": {...}}` and its answer
//! `{"id": n, "result": ...}` or `{"id": n, "error": "..."}`. Every method is
//! a read the app's own screens make, answered by the same function, so the
//! browser never sees a number the app does not. Nothing here writes.

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Value, json};

/// The detail screen's own minimum, so the browser reads what the app reads.
const MIN_ROUTE_ACTIVITIES: u32 = 1;

/// The largest feed page one request may ask for.
pub const MAX_PAGE: u32 = 100;

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FeedPage {
    #[serde(default)]
    offset: u32,
    limit: Option<u32>,
    #[serde(default)]
    needle: String,
}

#[derive(Deserialize)]
struct ActivityAsk {
    id: String,
}

fn params<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, String> {
    let params = if params.is_null() { json!({}) } else { params };
    serde_json::from_value(params).map_err(|error| format!("bad params: {error}"))
}

fn feed_page(conn: &Connection, ask: FeedPage) -> Result<Value, String> {
    let query = crate::FfiActivityBodiesQuery {
        oldest_ts: None,
        newest_ts: None,
        needle: ask.needle,
        sport_families: Vec::new(),
        offset: ask.offset,
        limit: Some(ask.limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)),
    };
    let page = crate::persistence::activities::pooled::feed_card_page(conn, &query)
        .map_err(|error| error.to_string())?;
    serde_json::to_value(page).map_err(|error| error.to_string())
}

fn activity_summary(conn: &Connection, ask: ActivityAsk) -> Result<Value, String> {
    let detail = crate::persistence::screens::pooled::activity_detail_data(
        conn,
        &ask.id,
        MIN_ROUTE_ACTIVITIES,
    );
    serde_json::to_value(detail.summary).map_err(|error| error.to_string())
}

/// Answer one request from a linked browser.
pub fn answer(conn: &Connection, request: &str) -> String {
    let Ok(request) = serde_json::from_str::<Request>(request) else {
        return json!({ "id": Value::Null, "error": "malformed request" }).to_string();
    };
    let result = match request.method.as_str() {
        "feed.page" => params(request.params).and_then(|ask| feed_page(conn, ask)),
        "activity.summary" => params(request.params).and_then(|ask| activity_summary(conn, ask)),
        other => Err(format!("unknown method: {other}")),
    };
    match result {
        Ok(result) => json!({ "id": request.id, "result": result }),
        Err(error) => json!({ "id": request.id, "error": error }),
    }
    .to_string()
}

#[cfg(test)]
#[path = "tests/protocol.rs"]
mod tests;
