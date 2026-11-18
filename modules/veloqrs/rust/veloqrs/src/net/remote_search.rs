//! The search of the athlete's account the feed offers once its local search
//! has run out.
//!
//! The server takes only a name, so a name is asked by name and the rest of the
//! feed's filter is applied here, to the rows that come back. With no name, a
//! date range is listed by its days. With neither, nothing is asked: a listing
//! of the whole account is not a search.

use crate::FfiActivityBodiesQuery;
use crate::FfiSportFamily;
use crate::governor::{Dispatch, Intent, Lane};
use crate::net::intervals::endpoints::SEARCH_LIMIT;
use crate::net::intervals::wire::RemoteActivitySummary;
use crate::net::source::Source;
use crate::net::transport::NetError;
use std::collections::HashSet;

#[derive(Debug, PartialEq)]
pub(crate) enum RemoteSearch {
    /// Neither a name nor a whole date range is set, so nothing was asked.
    NoQuery,
    /// The source has no search.
    Unavailable,
    Found {
        /// The rows the library does not hold and the filter admits, newest first.
        rows: Vec<RemoteActivitySummary>,
        /// How many rows the source answered with, before any were dropped.
        fetched: u32,
        /// Whether the source answered with as many as it will, so the rest of
        /// the account may hold more matches.
        capped: bool,
    },
}

/// What a query asks the source for.
#[derive(Debug, PartialEq)]
enum Request {
    Name(String),
    Window { oldest: String, newest: String },
}

/// The wall-clock-as-UTC day of an epoch second, the form the library stamps
/// start times in.
fn day_of(ts: f64) -> Option<String> {
    chrono::DateTime::from_timestamp(ts as i64, 0).map(|t| t.format("%Y-%m-%d").to_string())
}

fn request_for(query: &FfiActivityBodiesQuery) -> Option<Request> {
    let name = query.needle.trim();
    if !name.is_empty() {
        return Some(Request::Name(name.to_string()));
    }
    Some(Request::Window {
        oldest: day_of(query.oldest_ts?)?,
        newest: day_of(query.newest_ts?)?,
    })
}

/// Whether the row's start sits inside the query's date range, inclusive. A
/// row with no readable start fails a range that is set.
fn in_range(query: &FfiActivityBodiesQuery, start: Option<i64>) -> bool {
    let after = query
        .oldest_ts
        .is_none_or(|t| start.is_some_and(|s| s as f64 >= t));
    let before = query
        .newest_ts
        .is_none_or(|t| start.is_some_and(|s| s as f64 <= t));
    after && before
}

/// The start of a row as the library stamps it.
pub(crate) fn start_of(row: &RemoteActivitySummary) -> Option<i64> {
    crate::objects::sync::start_date_to_timestamp(row.start_date_local.as_deref())
}

/// Search the account for the query's rows the library does not hold.
///
/// `held` answers which of the server's ids the library already holds, and is
/// asked once, with every id the source returned.
pub(crate) async fn search<S: Source>(
    source: &S,
    query: &FfiActivityBodiesQuery,
    held: impl AsyncFnOnce(Vec<String>) -> HashSet<String>,
) -> Result<RemoteSearch, NetError> {
    let Some(request) = request_for(query) else {
        return Ok(RemoteSearch::NoQuery);
    };
    let dispatch = Dispatch::new(Lane::Interactive, Intent::User);
    let answered = match &request {
        Request::Name(name) => {
            source
                .search_activities(name, SEARCH_LIMIT, dispatch)
                .await?
        }
        Request::Window { oldest, newest } => {
            source.activity_summaries(oldest, newest, dispatch).await?
        }
    };
    let Some(answered) = answered else {
        return Ok(RemoteSearch::Unavailable);
    };
    let fetched = answered.len() as u32;
    // A window is not capped by the server, so only the name search can be
    // short of the account's matches.
    let capped = matches!(request, Request::Name(_)) && fetched >= SEARCH_LIMIT;
    let held = held(answered.iter().map(|row| row.id.clone()).collect()).await;
    let mut rows: Vec<(Option<i64>, RemoteActivitySummary)> = answered
        .into_iter()
        .filter(|row| !held.contains(&row.id))
        .map(|row| (start_of(&row), row))
        .filter(|(start, row)| {
            in_range(query, *start)
                && (query.sport_families.is_empty()
                    || query
                        .sport_families
                        .contains(&FfiSportFamily::of(&row.sport)))
                && query.admits_size(row.distance, row.moving_time)
        })
        .collect();
    // Newest first, a row with no start last, ties by id so the order is fixed.
    rows.sort_by(|(a_start, a), (b_start, b)| b_start.cmp(a_start).then_with(|| a.id.cmp(&b.id)));
    Ok(RemoteSearch::Found {
        rows: rows.into_iter().map(|(_, row)| row).collect(),
        fetched,
        capped,
    })
}

impl From<RemoteActivitySummary> for crate::FfiRemoteActivity {
    fn from(row: RemoteActivitySummary) -> Self {
        Self {
            id: row.id,
            name: row.name,
            sport_type: row.sport,
            start_date_local: row.start_date_local.unwrap_or_default(),
            distance: row.distance,
            moving_time: row.moving_time,
        }
    }
}

impl From<RemoteSearch> for crate::FfiRemoteActivitySearch {
    fn from(found: RemoteSearch) -> Self {
        use crate::FfiRemoteSearchStatus as Status;
        match found {
            RemoteSearch::NoQuery => Self::without_rows(Status::NoQuery),
            RemoteSearch::Unavailable => Self::without_rows(Status::Unavailable),
            RemoteSearch::Found {
                rows,
                fetched,
                capped,
            } => Self {
                status: Status::Found,
                rows: rows.into_iter().map(Into::into).collect(),
                fetched,
                capped,
            },
        }
    }
}

#[cfg(test)]
#[path = "tests/remote_search.rs"]
mod tests;
