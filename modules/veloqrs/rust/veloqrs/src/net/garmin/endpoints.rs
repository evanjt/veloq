//! One fetcher per Garmin endpoint. Every Garmin path and query is built
//! here, and every request goes through the transport from here.

use super::wire::ListedActivity;
use crate::governor::Dispatch;
use crate::net::transport::{NetError, Transport};
use std::io::Read;

/// The Garmin Personal API root.
pub(crate) const BASE_URL: &str = "https://personal.connectapi.garmin.com";

/// Entries Garmin returns for one page of the activity list, at most.
pub const PAGE_SIZE: usize = 99;

const TOKEN_PATH: &str = "/personalapitoken-service/personal-api/personal-api-key/token";
const LIST_PATH: &str = "/activitylist-service/activities/search/activities";

fn download_path(activity_id: i64) -> String {
    format!("/download-service/files/activity/{activity_id}")
}

/// Exchange the Personal key the transport carries for a token. The answer is
/// the token as plain text.
pub async fn fetch_token(t: &Transport, dispatch: impl Into<Dispatch>) -> Result<String, NetError> {
    let bytes = t.post_empty(TOKEN_PATH, dispatch).await?;
    let text = String::from_utf8(bytes).map_err(|e| NetError::Decode(e.to_string()))?;
    let token = text.trim();
    if token.is_empty() {
        return Err(NetError::Decode("the token answer was empty".into()));
    }
    Ok(token.to_string())
}

/// One page of the activity list. `start_date` and `end_date` are local
/// `YYYY-MM-DD` days and inclusive; `start` is the index of the first entry.
pub async fn fetch_activity_page(
    t: &Transport,
    start: usize,
    start_date: &str,
    end_date: &str,
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<ListedActivity>, NetError> {
    let start = start.to_string();
    let limit = PAGE_SIZE.to_string();
    t.get_json(
        LIST_PATH,
        &[
            ("start", start.as_str()),
            ("limit", limit.as_str()),
            ("startDate", start_date),
            ("endDate", end_date),
        ],
        dispatch,
    )
    .await
}

/// The original FIT of an activity, out of the zip Garmin answers with.
pub async fn fetch_original_fit(
    t: &Transport,
    activity_id: i64,
    dispatch: impl Into<Dispatch>,
) -> Result<Vec<u8>, NetError> {
    let zipped = t
        .get_bytes(&download_path(activity_id), &[], dispatch)
        .await?;
    unzip_fit(&zipped)
}

/// The first `.fit` entry of `zipped`.
pub(crate) fn unzip_fit(zipped: &[u8]) -> Result<Vec<u8>, NetError> {
    let decode = |e: &dyn std::fmt::Display| NetError::Decode(format!("download zip: {e}"));
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zipped)).map_err(|e| decode(&e))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| decode(&e))?;
        if entry.is_file()
            && entry
                .name()
                .is_ok_and(|n| n.to_ascii_lowercase().ends_with(".fit"))
        {
            let mut fit = Vec::new();
            entry.read_to_end(&mut fit).map_err(|e| decode(&e))?;
            return Ok(fit);
        }
    }
    Err(NetError::Decode("download zip holds no FIT file".into()))
}
