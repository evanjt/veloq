//! A collection a linked browser sends to the phone.
//!
//! The browser sends one archive (a zip, a FIT or a gzipped FIT) as binary
//! frames on the data channel, after asking `import.begin` over the text
//! channel. Each frame is appended to a spool file under the files root as it
//! arrives and is not kept in memory past the write. The page keeps nothing but
//! its file handle, so after a dropped link only the phone knows how much
//! arrived: `import.begin` for the same digest answers the length of the spool
//! already there, and the page sends the rest.
//!
//! `import.commit` checks the whole spool against the digest `begin` named and
//! hands the file to the import job; a spool that does not match is deleted.
//! A spool nobody commits is deleted by [`sweep`] when it has not been written
//! to for a day.
//!
//! An inbound frame is `[u8 version, u8 flags, u32 import id, u32 seq, bytes]`,
//! the numbers big-endian like a reply frame's, with at most [`MAX_PAYLOAD`]
//! bytes after the header. `seq` counts from 0 for each `begin`, and a frame
//! is appended only when it is the next one expected, so a frame that was
//! lost, repeated or reordered is dropped and the spool is never written
//! out of place.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Deserialize;

use super::digest::Sha256Stream;

/// The directory under the files root the spools live in.
pub const IMPORTS: &str = "imports";

/// The most bytes of the archive one frame carries.
pub const MAX_PAYLOAD: usize = 16 * 1024;

/// The bytes before the payload.
pub const HEADER_BYTES: usize = 10;

/// The frame layout this build reads.
pub const FRAME_VERSION: u8 = 1;

/// The largest archive a begin is accepted for. The measured collection of
/// 1,600 rides is 91 MB zipped.
pub const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// How long a spool may go unwritten before [`sweep`] deletes it.
pub const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// The longest name a begin carries.
const MAX_NAME_BYTES: usize = 255;

/// What `import.begin` asks.
#[derive(Debug, Clone, Deserialize)]
pub struct Begin {
    /// The archive's name on the athlete's computer, which says what it is.
    pub name: String,
    pub size: u64,
    /// The lowercase hex SHA-256 of the whole archive.
    pub sha256: String,
}

/// What `import.begin` answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Begun {
    pub import_id: u32,
    /// The bytes of this archive already on the phone.
    pub offset: u64,
}

/// What became of one inbound frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Appended,
    Dropped(&'static str),
}

/// One import in progress.
struct Import {
    id: u32,
    /// The fingerprint of the browser that began it, the only one whose
    /// frames, commit and cancel it takes.
    browser: String,
    sha256: String,
    size: u64,
    received: u64,
    next_seq: u32,
    /// The extension the archive is handed over under, which the walk reads
    /// to know what it is.
    extension: &'static str,
    part: PathBuf,
    file: File,
}

/// The imports in progress and a count of the frames dropped.
#[derive(Default)]
pub struct Spools {
    last_id: u32,
    imports: Vec<Import>,
    dropped: u64,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn is_digest(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// The extension a name says its archive has, among those the walk reads.
fn extension_of(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    [("zip", ".zip"), ("gz", ".gz"), ("fit", ".fit")]
        .into_iter()
        .find_map(|(extension, suffix)| lower.ends_with(suffix).then_some(extension))
}

fn spool_dir(root: &Path) -> PathBuf {
    root.join(IMPORTS)
}

impl Spools {
    /// Frames dropped since this registry began.
    pub fn dropped(&self) -> u64 {
        self.dropped
    }

    /// Begin, or resume, the import of the archive `ask` names for `browser`.
    /// The answer's offset is the length of a spool of that digest already
    /// under `root`, 0 for a new one. Any import of the same digest begun
    /// before is replaced, so only the newest id takes frames.
    pub fn begin(&mut self, root: &Path, browser: &str, ask: &Begin) -> Result<Begun, String> {
        if !is_digest(&ask.sha256) {
            return Err("sha256 is not 64 lowercase hex digits".into());
        }
        if ask.size == 0 || ask.size > MAX_BYTES {
            return Err(format!("size must be 1 to {MAX_BYTES} bytes"));
        }
        if ask.name.len() > MAX_NAME_BYTES {
            return Err("name is too long".into());
        }
        let extension =
            extension_of(&ask.name).ok_or("only a zip, a FIT or a gzipped FIT can be imported")?;

        self.imports.retain(|held| held.sha256 != ask.sha256);
        let dir = spool_dir(root);
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let part = dir.join(format!("{}.part", ask.sha256));
        let held = std::fs::metadata(&part).map_or(0, |meta| meta.len());
        if held > ask.size {
            std::fs::remove_file(&part).map_err(|error| error.to_string())?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part)
            .map_err(|error| error.to_string())?;
        let offset = file.metadata().map_err(|error| error.to_string())?.len();

        self.last_id = self.last_id.wrapping_add(1).max(1);
        let import_id = self.last_id;
        self.imports.push(Import {
            id: import_id,
            browser: browser.to_owned(),
            sha256: ask.sha256.clone(),
            size: ask.size,
            received: offset,
            next_seq: 0,
            extension,
            part,
            file,
        });
        Ok(Begun { import_id, offset })
    }

    /// Append one inbound frame from `browser` to its spool when it is the
    /// next one that browser's import expects. Anything else is dropped and
    /// counted.
    pub fn frame(&mut self, browser: &str, bytes: &[u8]) -> Frame {
        let outcome = self.append(browser, bytes);
        if matches!(outcome, Frame::Dropped(_)) {
            self.dropped += 1;
        }
        outcome
    }

    fn append(&mut self, browser: &str, bytes: &[u8]) -> Frame {
        if bytes.len() <= HEADER_BYTES || bytes.len() > HEADER_BYTES + MAX_PAYLOAD {
            return Frame::Dropped("a frame carries 1 to 16 KiB after its header");
        }
        if bytes[0] != FRAME_VERSION {
            return Frame::Dropped("unknown frame version");
        }
        let id = u32::from_be_bytes([bytes[2], bytes[3], bytes[4], bytes[5]]);
        let seq = u32::from_be_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]);
        let payload = &bytes[HEADER_BYTES..];
        let Some(import) = self
            .imports
            .iter_mut()
            .find(|import| import.id == id && import.browser == browser)
        else {
            return Frame::Dropped("no such import for this browser");
        };
        if seq != import.next_seq {
            return Frame::Dropped("not the next frame");
        }
        if import.received + payload.len() as u64 > import.size {
            return Frame::Dropped("past the size begun");
        }
        if import.file.write_all(payload).is_err() {
            return Frame::Dropped("the spool could not be written");
        }
        import.received += payload.len() as u64;
        import.next_seq += 1;
        Frame::Appended
    }

    fn position(&self, browser: &str, id: u32) -> Result<usize, String> {
        self.imports
            .iter()
            .position(|import| import.id == id && import.browser == browser)
            .ok_or_else(|| "no such import".to_owned())
    }

    /// Check the spool of import `id` against its digest and give the file to
    /// `hand_over`, under a name that says what it is. A spool that does not
    /// match is deleted. A spool not yet whole, or one `hand_over` refuses, is
    /// kept for a later commit. Returns the path handed over.
    pub fn commit(
        &mut self,
        browser: &str,
        id: u32,
        hand_over: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        let at = self.position(browser, id)?;
        let import = &self.imports[at];
        if import.received != import.size {
            return Err(format!(
                "incomplete: {} of {} bytes",
                import.received, import.size
            ));
        }
        let digest = digest_of(&import.part).map_err(|error| error.to_string())?;
        if hex(&digest) != import.sha256 {
            let import = self.imports.remove(at);
            let _ = std::fs::remove_file(&import.part);
            return Err("checksum mismatch: the archive was not received intact".into());
        }
        let ready = import.part.with_extension(import.extension);
        std::fs::rename(&import.part, &ready).map_err(|error| error.to_string())?;
        if let Err(error) = hand_over(&ready) {
            let import = &self.imports[at];
            std::fs::rename(&ready, &import.part).map_err(|e| e.to_string())?;
            return Err(error);
        }
        self.imports.remove(at);
        Ok(ready)
    }

    /// Delete the spool of import `id`.
    pub fn cancel(&mut self, browser: &str, id: u32) -> Result<(), String> {
        let at = self.position(browser, id)?;
        let import = self.imports.remove(at);
        std::fs::remove_file(&import.part).map_err(|error| error.to_string())
    }
}

fn digest_of(path: &Path) -> std::io::Result<[u8; 32]> {
    let mut file = File::open(path)?;
    let mut stream = Sha256Stream::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Ok(stream.finish());
        }
        stream.update(&buffer[..read]);
    }
}

/// Delete every file under `root`'s spool directory that has not been written
/// to for [`STALE_AFTER`] before `now`. Returns how many were deleted.
pub fn sweep(root: &Path, now: SystemTime) -> usize {
    let Ok(entries) = std::fs::read_dir(spool_dir(root)) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) else {
                return false;
            };
            now.duration_since(modified)
                .is_ok_and(|age| age > STALE_AFTER)
        })
        .filter(|entry| std::fs::remove_file(entry.path()).is_ok())
        .count()
}

/// The imports in progress in this process.
static SPOOLS: Mutex<Option<Spools>> = Mutex::new(None);

fn with_spools<R>(work: impl FnOnce(&mut Spools) -> R) -> R {
    let mut held = SPOOLS.lock().unwrap_or_else(|e| e.into_inner());
    work(held.get_or_insert_with(Spools::default))
}

/// Forget every import in progress and delete every spool beside the database
/// at `db_path`, as a wipe of the library does. A database with no directory
/// of its own, such as an in-memory one, has no spools.
pub fn forget_all_beside(db_path: &str) {
    with_spools(|spools| spools.imports.clear());
    let Some(dir) = Path::new(db_path)
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
    else {
        return;
    };
    let _ = std::fs::remove_dir_all(spool_dir(dir));
}

/// The directory the library's files live in: the one holding its database.
pub fn files_root() -> Result<PathBuf, String> {
    let (_, db) = crate::persistence::read_pool::binding().ok_or("engine not initialised")?;
    Path::new(&db)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "the database has no directory".to_owned())
}

/// `import.begin` for `browser`.
pub fn begin(browser: &str, ask: &Begin) -> Result<Begun, String> {
    let root = files_root()?;
    with_spools(|spools| spools.begin(&root, browser, ask))
}

/// One inbound binary frame from `browser`.
pub fn frame(browser: &str, bytes: &[u8]) -> Frame {
    let outcome = with_spools(|spools| spools.frame(browser, bytes));
    if let Frame::Dropped(reason) = outcome {
        log::debug!("remote link: an import frame was dropped: {reason}");
    }
    outcome
}

/// `import.commit` for `browser`: the archive goes to the import job.
pub fn commit(browser: &str, id: u32) -> Result<(), String> {
    let install = crate::persistence::engine_install();
    with_spools(|spools| {
        spools
            .commit(browser, id, |path| {
                if crate::net::import::start(install, path.to_path_buf()) {
                    Ok(())
                } else {
                    Err("an import or a Garmin pull is already running".to_owned())
                }
            })
            .map(drop)
    })
}

/// `import.cancel` for `browser`.
pub fn cancel(browser: &str, id: u32) -> Result<(), String> {
    with_spools(|spools| spools.cancel(browser, id))
}

/// Delete the spools nobody finished, which the link does as it starts.
pub fn sweep_stale() {
    if let Ok(root) = files_root() {
        sweep(&root, SystemTime::now());
    }
}

#[cfg(test)]
#[path = "tests/import.rs"]
mod tests;
