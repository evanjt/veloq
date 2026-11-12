//! What a linked browser may ask, and the answer to each ask.
//!
//! A request is `{"id": n, "method": "...", "params": {...}}` and its answer
//! `{"id": n, "result": ...}` or `{"id": n, "error": "..."}`. Every method is
//! a read the app's own screens make, answered by the same function, so the
//! browser never sees a number the app does not.
//!
//! Reads are answered from a pooled connection and can write nothing. Writes
//! are rows of the same table marked as writes, answered under the engine lock
//! on the peer thread by the function the phone's own screen calls. A method
//! not in the table is `unknown method`, which is how a phone-only operation
//! (credentials, sign-out, clearing the library, backup, restore, linked
//! devices, pairing, experimental and debug switches, deletes) is refused: it
//! is never added.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The detail screen's own minimum, so the browser reads what the app reads.
const MIN_ROUTE_ACTIVITIES: u32 = 1;

/// The largest feed page one request may ask for.
pub const MAX_PAGE: u32 = 100;

/// The version of the request, answer and reply-frame shapes. A method added
/// within a version is additive; a method removed or reshaped bumps it, and so
/// does any change to the frame layout or its encoding. A page built for another
/// version shows the update state instead of asking. The tests pin the wire
/// format to this number, so a change to the wire format without a bump fails.
pub const PROTOCOL_VERSION: u32 = 3;

/// What `link.hello` is asked: the protocol the page was built for and a name
/// for the page.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHello {
    pub protocol: u32,
    pub page: String,
}

/// What `link.hello` answers: the protocol the phone speaks, the app version
/// and the name of every method it answers.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHelloAnswer {
    pub protocol: u32,
    pub app: String,
    pub methods: Vec<String>,
}

/// What `feed.page` is asked: a window of the feed, narrowed by a search, a
/// set of sport families and a span of start times, as the phone's own filter
/// chips narrow it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkFeedPageAsk {
    #[serde(default)]
    pub offset: u32,
    /// None asks for the largest page the phone allows.
    pub limit: Option<u32>,
    #[serde(default)]
    pub needle: String,
    /// Empty matches every sport.
    #[serde(default)]
    pub sport_families: Vec<crate::FfiSportFamily>,
    /// Inclusive start time in epoch seconds; None reaches the oldest.
    #[serde(default)]
    pub oldest_ts: Option<f64>,
    /// Inclusive start time in epoch seconds; None reaches the newest.
    #[serde(default)]
    pub newest_ts: Option<f64>,
}

/// What `feed.summary` is asked: the phone's wall-clock time in seconds, from
/// which the engine resolves this week and the one before.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSummaryAsk {
    pub now_wall_seconds: f64,
}

/// What `feed.sparklines` is asked: how many days the series reach back.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSparklinesAsk {
    pub days: u32,
}

/// What `feed.highlights` is asked: the cards a page shows, at most one page.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkHighlightsAsk {
    pub ids: Vec<String>,
}

/// What a method that reads one activity is asked.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkActivityAsk {
    pub id: String,
}

/// What `section.rename` is asked: the section and its new name, where an
/// empty name clears it.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkSectionRenameAsk {
    pub id: String,
    pub name: String,
}

/// What a write answers once it is made.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiLinkWriteDone {
    pub ok: bool,
}

/// How a method is answered: a read from a pooled connection, or a write
/// under the engine lock.
enum Run {
    Read(fn(&Connection, Value) -> Result<Value, String>),
    Write(fn(&mut crate::persistence::PersistentEngine, Value) -> Result<Value, String>),
}

/// One method of the protocol: its name, the records its ask and its answer
/// are, and the read or write that answers it.
pub struct Method {
    pub name: &'static str,
    /// The `uniffi::Record` the params deserialise into.
    pub params: &'static str,
    /// The `uniffi::Record` the result serialises from.
    pub result: &'static str,
    run: Run,
}

impl Method {
    /// Whether the write channel, not the read channel, answers this method.
    pub fn is_write(&self) -> bool {
        matches!(self.run, Run::Write(_))
    }
}

/// Every method a linked browser may ask. `answer` and `answer_write`
/// dispatch through it, the `link.hello` answer lists it and
/// `web/connect/methods.json` is rendered from it, so a method is a row here
/// and an arm nowhere else. The pairing methods are not rows: they are
/// answered before a browser is linked. Adding a write is a change to the
/// test that pins the writes.
pub const METHODS: &[Method] = &[
    Method {
        name: "link.hello",
        params: "FfiLinkHello",
        result: "FfiLinkHelloAnswer",
        run: Run::Read(hello),
    },
    Method {
        name: "feed.page",
        params: "FfiLinkFeedPageAsk",
        result: "FfiFeedCardsPage",
        run: Run::Read(feed_page),
    },
    Method {
        name: "feed.summary",
        params: "FfiLinkSummaryAsk",
        result: "FfiSummaryCardData",
        run: Run::Read(feed_summary),
    },
    Method {
        name: "feed.sparklines",
        params: "FfiLinkSparklinesAsk",
        result: "FfiWellnessSparklines",
        run: Run::Read(feed_sparklines),
    },
    Method {
        name: "feed.highlights",
        params: "FfiLinkHighlightsAsk",
        result: "FfiActivityHighlightsBundle",
        run: Run::Read(feed_highlights),
    },
    Method {
        name: "activity.summary",
        params: "FfiLinkActivityAsk",
        result: "FfiActivitySummary",
        run: Run::Read(activity_summary),
    },
    Method {
        name: "section.rename",
        params: "FfiLinkSectionRenameAsk",
        result: "FfiLinkWriteDone",
        run: Run::Write(section_rename),
    },
];

fn method(name: &str) -> Option<&'static Method> {
    METHODS.iter().find(|method| method.name == name)
}

/// Whether the write channel, not the read channel, answers this method.
pub fn is_write(name: &str) -> bool {
    method(name).is_some_and(Method::is_write)
}

/// The text of `web/connect/methods.json`: the version and the table.
pub fn methods_json() -> String {
    let methods: Vec<Value> = METHODS
        .iter()
        .map(|method| {
            json!({
                "name": method.name,
                "params": method.params,
                "result": method.result,
                "write": method.is_write(),
            })
        })
        .collect();
    let mut text = serde_json::to_string_pretty(&json!({
        "protocol": PROTOCOL_VERSION,
        "methods": methods,
    }))
    .expect("a table of strings serialises");
    text.push('\n');
    text
}

/// The raw size limit of one message on the data channel, header included.
/// Chrome refuses a message above 256 KiB whatever the peer advertises, and
/// str0m assumes 64 KiB when an offer advertises none, so 16 KiB is under
/// every limit and no peer's advertised size matters. `web/connect/link.ts`
/// holds the same number as `FRAME_BYTES`.
pub const FRAME_BYTES: usize = 16 * 1024;

/// The header every reply frame starts with, all numbers big-endian: a `u8`
/// version ([`FRAME_VERSION`]), a `u8` of flags ([`FRAME_GZIP`],
/// [`FRAME_LAST`]), the `u32` id of the request answered and the `u32` of this
/// frame's place in the reply, from 0. The id is what tells the page one
/// reply's frames from another's when several are in flight.
pub const FRAME_HEADER_BYTES: usize = 10;

/// The frame layout this build writes.
pub const FRAME_VERSION: u8 = 1;

/// Flag: the reply bytes, joined, are a gzip stream of the reply text.
pub const FRAME_GZIP: u8 = 1;

/// Flag: this is the last frame of its reply.
pub const FRAME_LAST: u8 = 2;

/// A reply text longer than this is gzipped before it is cut.
pub const GZIP_OVER: usize = 4 * 1024;

/// The gzip level a reply is compressed at.
const GZIP_LEVEL: u32 = 6;

/// A reply as the binary frames that carry it. Requests stay JSON text; every
/// reply is one or more frames of at most [`FRAME_BYTES`], a [`FRAME_HEADER_BYTES`]
/// header and then a slice of the reply, which is gzipped first when its text
/// is over [`GZIP_OVER`]. The request id comes from the reply's own `id`; a
/// reply with none (a request that did not parse) goes under id 0, which the
/// page never asks with.
pub fn frames(reply: &str) -> Vec<Vec<u8>> {
    #[derive(Deserialize)]
    struct Id {
        id: Option<u64>,
    }
    let id = serde_json::from_str::<Id>(reply)
        .ok()
        .and_then(|reply| reply.id)
        .and_then(|id| u32::try_from(id).ok())
        .unwrap_or(0);

    let (flags, body) = if reply.len() > GZIP_OVER {
        let mut gzip = flate2::write::GzEncoder::new(
            Vec::with_capacity(reply.len() / 4),
            flate2::Compression::new(GZIP_LEVEL),
        );
        let packed =
            std::io::Write::write_all(&mut gzip, reply.as_bytes()).and_then(|()| gzip.finish());
        match packed {
            Ok(packed) => (FRAME_GZIP, packed),
            Err(_) => (0, reply.as_bytes().to_vec()),
        }
    } else {
        (0, reply.as_bytes().to_vec())
    };

    let mut chunks: Vec<&[u8]> = body.chunks(FRAME_BYTES - FRAME_HEADER_BYTES).collect();
    if chunks.is_empty() {
        chunks.push(&[]);
    }
    let last = chunks.len() - 1;
    chunks
        .into_iter()
        .enumerate()
        .map(|(seq, chunk)| {
            let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + chunk.len());
            frame.push(FRAME_VERSION);
            frame.push(flags | if seq == last { FRAME_LAST } else { 0 });
            frame.extend_from_slice(&id.to_be_bytes());
            frame.extend_from_slice(&(seq as u32).to_be_bytes());
            frame.extend_from_slice(chunk);
            frame
        })
        .collect()
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

fn params<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, String> {
    let params = if params.is_null() { json!({}) } else { params };
    serde_json::from_value(params).map_err(|error| format!("bad params: {error}"))
}

fn to_result<T: Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn hello(_conn: &Connection, ask: Value) -> Result<Value, String> {
    let _: FfiLinkHello = params(ask)?;
    to_result(&FfiLinkHelloAnswer {
        protocol: PROTOCOL_VERSION,
        app: env!("CARGO_PKG_VERSION").to_owned(),
        methods: METHODS
            .iter()
            .map(|method| method.name.to_owned())
            .collect(),
    })
}

fn feed_page(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkFeedPageAsk = params(ask)?;
    let query = crate::FfiActivityBodiesQuery {
        oldest_ts: ask.oldest_ts,
        newest_ts: ask.newest_ts,
        needle: ask.needle,
        sport_families: ask.sport_families,
        offset: ask.offset,
        limit: Some(ask.limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)),
    };
    let page = crate::persistence::activities::pooled::feed_card_page(conn, &query)
        .map_err(|error| error.to_string())?;
    to_result(&page)
}

fn feed_summary(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkSummaryAsk = params(ask)?;
    let (current_start, current_end, prev_start, prev_end) =
        crate::widget_snapshot::week_bounds(crate::ffi_types::int_from_wire(ask.now_wall_seconds));
    to_result(&crate::persistence::screens::pooled::summary_card(
        conn,
        current_start,
        current_end,
        prev_start,
        prev_end,
    ))
}

/// The series answer is `null` when the athlete has no wellness rows, as the
/// phone's read is `None`.
fn feed_sparklines(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkSparklinesAsk = params(ask)?;
    let lines = crate::persistence::wellness::pooled::sparklines_to(
        conn,
        ask.days,
        &crate::persistence::wellness::today_iso(),
    )
    .map_err(|error| error.to_string())?;
    to_result(&lines)
}

fn feed_highlights(conn: &Connection, ask: Value) -> Result<Value, String> {
    let mut ask: FfiLinkHighlightsAsk = params(ask)?;
    ask.ids.truncate(MAX_PAGE as usize);
    to_result(&crate::objects::activities::highlights_bundle(
        conn, &ask.ids,
    ))
}

fn activity_summary(conn: &Connection, ask: Value) -> Result<Value, String> {
    let ask: FfiLinkActivityAsk = params(ask)?;
    let detail = crate::persistence::screens::pooled::activity_detail_data(
        conn,
        &ask.id,
        MIN_ROUTE_ACTIVITIES,
    );
    to_result(&detail.summary)
}

fn section_rename(
    engine: &mut crate::persistence::PersistentEngine,
    ask: Value,
) -> Result<Value, String> {
    let ask: FfiLinkSectionRenameAsk = params(ask)?;
    crate::objects::sections::rename_section(engine, &ask.id, &ask.name)
        .map_err(|error| error.to_string())?;
    to_result(&FfiLinkWriteDone { ok: true })
}

fn reply(id: u64, result: Result<Value, String>) -> String {
    match result {
        Ok(result) => json!({ "id": id, "result": result }),
        Err(error) => json!({ "id": id, "error": error }),
    }
    .to_string()
}

fn malformed() -> String {
    json!({ "id": Value::Null, "error": "malformed request" }).to_string()
}

/// Answer one read from a linked browser. A write is unknown here, so the
/// pooled connection never runs one.
pub fn answer(conn: &Connection, request: &str) -> String {
    let Ok(request) = serde_json::from_str::<Request>(request) else {
        return malformed();
    };
    let result = match method(&request.method).map(|method| &method.run) {
        Some(Run::Read(run)) => run(conn, request.params),
        _ => Err(format!("unknown method: {}", request.method)),
    };
    reply(request.id, result)
}

/// Answer one write from the linked browser that presented `browser`, under
/// the engine lock the caller holds. `browser` names who made the write.
pub fn answer_write(
    engine: &mut crate::persistence::PersistentEngine,
    _browser: &str,
    request: &str,
) -> String {
    let Ok(request) = serde_json::from_str::<Request>(request) else {
        return malformed();
    };
    let result = match method(&request.method).map(|method| &method.run) {
        Some(Run::Write(run)) => run(engine, request.params),
        _ => Err(format!("unknown method: {}", request.method)),
    };
    reply(request.id, result)
}

#[cfg(test)]
#[path = "tests/protocol.rs"]
mod tests;
