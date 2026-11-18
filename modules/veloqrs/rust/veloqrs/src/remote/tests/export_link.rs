//! Scenario: a client reads a library export through a real connection: it
//! begins one, polls its status to ready, reads it in 1 MiB asks, loses the
//! link part way and reads on from its own byte count after reconnecting.
//!
//! Expected behaviour: the raw frames of every read join, under their request
//! ids, into bytes whose SHA-256 is the digest `export.status` named, and a
//! read that cannot be answered is a text error rather than frames.

use super::*;
use crate::persistence::library_export::LibraryExportResult;
use crate::remote::digest::sha256;
use crate::remote::export::{Archive, MAX_READ, Spools, read_shared, status_shared};
use crate::remote::import::{digest_of, hex};
use crate::remote::protocol::{Answer, FRAME_RAW};
use serde_json::{Value, json};
use tempfile::TempDir;

/// Polls of `export.status` that find the build still running.
const BUILDING_POLLS: u32 = 2;

/// Serves the four `export.*` rows from a spool registry of its own, under
/// the certificate each connection presented, as the engine's gate does.
struct ExportGate {
    pinned: Vec<String>,
    root: TempDir,
    spools: Mutex<Spools>,
    archive: Vec<u8>,
    /// Calls of the archive digest, which the build reads once when it finishes.
    hashed: Arc<AtomicUsize>,
}

impl ExportGate {
    fn text(id: u64, outcome: Result<Value, String>) -> Answer {
        Answer::Text(
            match outcome {
                Ok(result) => json!({ "id": id, "result": result }),
                Err(error) => json!({ "id": id, "error": error }),
            }
            .to_string(),
        )
    }
}

impl Gate for ExportGate {
    fn is_pinned(&self, fingerprint: &str) -> bool {
        self.pinned.iter().any(|pinned| pinned == fingerprint)
    }

    fn answer(&self, _presented: &str, _local: &str, _request: &str) -> String {
        unreachable!("every ask of this gate is answered as bytes")
    }

    fn answer_bytes(&self, presented: &str, _local: &str, request: &str) -> Answer {
        let ask: Value = serde_json::from_str(request).unwrap();
        let id = ask["id"].as_u64().unwrap();
        let params = &ask["params"];
        let export_id = params["exportId"].as_str().unwrap_or_default();
        match ask["method"].as_str().unwrap() {
            "export.begin" => {
                let archive = self.archive.clone();
                let hashed = Arc::clone(&self.hashed);
                let begun = self.spools.lock().unwrap().begin(
                    self.root.path(),
                    presented,
                    Arc::new(|| None),
                    move |dest, _| {
                        std::fs::write(dest, &archive).unwrap();
                        let dest = dest.to_path_buf();
                        let mut polls = 0;
                        Box::new(move || {
                            polls += 1;
                            (polls > BUILDING_POLLS).then(|| {
                                hashed.fetch_add(1, Ordering::SeqCst);
                                Ok(Archive {
                                    result: LibraryExportResult {
                                        rides: 3,
                                        originals: 0,
                                        tables: 0,
                                        total_bytes: 0.0,
                                    },
                                    digest: digest_of(&dest),
                                })
                            })
                        })
                    },
                );
                Self::text(id, begun.map(|export_id| json!({ "exportId": export_id })))
            }
            "export.status" => {
                let status = status_shared(&self.spools, presented, export_id);
                Self::text(
                    id,
                    status.map(|status| {
                        json!({
                            "state": status.state,
                            "bytes": status.bytes,
                            "sha256": status.sha256,
                        })
                    }),
                )
            }
            "export.read" => {
                let read = read_shared(
                    &self.spools,
                    presented,
                    export_id,
                    params["offset"].as_u64().unwrap(),
                    params["length"].as_u64().unwrap(),
                );
                match read {
                    Ok(bytes) => Answer::Raw {
                        id: u32::try_from(id).unwrap(),
                        bytes,
                    },
                    Err(error) => Self::text(id, Err(error)),
                }
            }
            "export.done" => {
                let done = self.spools.lock().unwrap().done(presented, export_id);
                Self::text(id, done.map(|()| json!({ "ok": true })))
            }
            other => panic!("an ask of {other}"),
        }
    }

    fn connected(&self, _: &str, _: Option<SocketAddr>, _: SocketAddr) {}
    fn disconnected(&self, _: &str, _: Option<DisconnectReason>) {}
    fn changed(&self) -> Option<u64> {
        None
    }
}

fn ask(id: u64, method: &str, params: Value) -> String {
    json!({ "id": id, "method": method, "protocol": 3, "params": params }).to_string()
}

/// Send `ask` on the open channel and return the frames that answer it.
fn exchange(browser: &mut Browser, ask: &str) -> Vec<Vec<u8>> {
    let channel = browser.channel.expect("the channel is open");
    browser
        .rtc
        .channel(channel)
        .unwrap()
        .write(false, ask.as_bytes())
        .unwrap();
    browser
        .run_script(&[], &[], Duration::ZERO, 1, Duration::from_secs(20))
        .1
}

/// The JSON a text reply carries, whichever way it was framed.
fn json_of(frames: &[Vec<u8>], id: u32) -> Value {
    serde_json::from_str(&joined(frames)[&id]).unwrap()
}

/// The bytes a raw reply carries, each frame checked against the limit.
fn raw_of(frames: &[Vec<u8>], id: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    for (seq, frame) in frames.iter().enumerate() {
        assert!(frame.len() <= FRAME_BYTES);
        assert_eq!(frame[0], FRAME_VERSION);
        assert_ne!(frame[1] & FRAME_RAW, 0, "frame {seq} is not raw");
        assert_eq!(frame[1] & FRAME_GZIP, 0);
        assert_eq!(u32::from_be_bytes(frame[2..6].try_into().unwrap()), id);
        assert_eq!(
            u32::from_be_bytes(frame[6..10].try_into().unwrap()) as usize,
            seq
        );
        assert_eq!(frame[1] & FRAME_LAST != 0, seq == frames.len() - 1);
        bytes.extend_from_slice(&frame[FRAME_HEADER_BYTES..]);
    }
    bytes
}

/// Ask for the export's status until it is ready, returning its reply.
fn status_when_ready(browser: &mut Browser, first_id: u64, export_id: &str) -> Value {
    for id in first_id..first_id + 20 {
        let frames = exchange(
            browser,
            &ask(id, "export.status", json!({ "exportId": export_id })),
        );
        let status = json_of(&frames, id as u32);
        if status["result"]["state"] == "ready" {
            return status["result"].clone();
        }
        assert_eq!(status["result"]["state"], "building", "{status}");
    }
    panic!("the export never became ready");
}

fn read(browser: &mut Browser, id: u64, export_id: &str, offset: u64, length: u64) -> Vec<u8> {
    let frames = exchange(
        browser,
        &ask(
            id,
            "export.read",
            json!({ "exportId": export_id, "offset": offset, "length": length }),
        ),
    );
    raw_of(&frames, id as u32)
}

fn connect(gate: &Arc<ExportGate>, offer: &str, browser: &mut Browser) -> Peer {
    let (answer, peer) =
        accept(offer, certificate(), loopback(), gate.clone(), None).expect("accepted");
    browser.take_answer(&answer);
    peer
}

#[test]
fn an_export_is_read_over_the_link_and_a_dropped_link_is_read_on_from_the_clients_count() {
    let archive: Vec<u8> = (0..2 * MAX_READ as u32 + 1000)
        .map(|n| (n * 7 % 251) as u8)
        .collect();
    let identity = certificate();
    let (mut browser, offer) = Browser::with_certificate(identity.clone());
    let gate = Arc::new(ExportGate {
        pinned: vec![browser.fingerprint.clone()],
        root: TempDir::new().unwrap(),
        spools: Mutex::new(Spools::default()),
        archive: archive.clone(),
        hashed: Arc::new(AtomicUsize::new(0)),
    });
    let peer = connect(&gate, &offer, &mut browser);

    let (opened, begun) = browser.run(&ask(1, "export.begin", json!({})), Duration::from_secs(10));
    assert!(opened);
    let export_id = json_of(&begun, 1)["result"]["exportId"]
        .as_str()
        .unwrap()
        .to_owned();
    let status = status_when_ready(&mut browser, 2, &export_id);
    let digest = hex(&sha256(&[&archive]));
    assert_eq!(status["sha256"], digest.as_str());
    assert_eq!(status["bytes"], archive.len());

    // The first megabyte arrives, then the link drops.
    let mut held = read(&mut browser, 30, &export_id, 0, MAX_READ);
    assert_eq!(held.len() as u64, MAX_READ);
    peer.stop(DisconnectReason::Disconnected);
    drop(browser);

    let (mut browser, offer) = Browser::with_certificate(identity);
    let peer = connect(&gate, &offer, &mut browser);
    let (opened, again) = browser.run(
        &ask(1, "export.status", json!({ "exportId": export_id })),
        Duration::from_secs(10),
    );
    assert!(opened);
    let again = json_of(&again, 1)["result"].clone();
    assert_eq!(again["sha256"], status["sha256"]);
    assert_eq!(again["state"], "ready");

    let mut id = 2;
    while (held.len() as u64) < again["bytes"].as_u64().unwrap() {
        held.extend(read(
            &mut browser,
            id,
            &export_id,
            held.len() as u64,
            MAX_READ,
        ));
        id += 1;
    }
    assert_eq!(held.len(), archive.len());
    assert_eq!(hex(&sha256(&[&held])), digest);
    assert_eq!(held, archive);
    assert_eq!(
        gate.hashed.load(Ordering::SeqCst),
        1,
        "the archive is hashed once, not on every status"
    );

    // A read at the end is a text error, not an empty frame set.
    let frames = exchange(
        &mut browser,
        &ask(
            id,
            "export.read",
            json!({ "exportId": export_id, "offset": archive.len(), "length": 1 }),
        ),
    );
    assert_eq!(frames.iter().filter(|f| f[1] & FRAME_RAW != 0).count(), 0);
    assert!(
        json_of(&frames, id as u32)["error"]
            .as_str()
            .unwrap()
            .contains("past the end")
    );

    let frames = exchange(
        &mut browser,
        &ask(id + 1, "export.done", json!({ "exportId": export_id })),
    );
    assert_eq!(json_of(&frames, id as u32 + 1)["result"]["ok"], true);
    let frames = exchange(
        &mut browser,
        &ask(
            id + 2,
            "export.read",
            json!({ "exportId": export_id, "offset": 0, "length": 1 }),
        ),
    );
    assert!(json_of(&frames, id as u32 + 2)["error"].is_string());
    peer.stop(DisconnectReason::Disconnected);
}
