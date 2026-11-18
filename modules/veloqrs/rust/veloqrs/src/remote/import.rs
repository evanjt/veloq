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

/// The free space left untouched after a spool is accounted for, so the
/// database can still write while an import is in flight.
pub const FREE_SPACE_MARGIN: u64 = 256 * 1024 * 1024;

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

pub(super) fn hex(bytes: &[u8]) -> String {
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

/// The bytes free to this process on the volume holding `root`, `None` where
/// that cannot be read.
#[cfg(unix)]
pub(super) fn free_space(root: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let mut probe = root;
    while !probe.exists() {
        probe = probe.parent()?;
    }
    let path = std::ffi::CString::new(probe.as_os_str().as_bytes()).ok()?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::zeroed();
    // SAFETY: `path` is a valid NUL-terminated string and `stat` is a writable
    // `statvfs` the call fills on success.
    if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: statvfs returned 0, so the struct is initialised.
    let stat = unsafe { stat.assume_init() };
    // The fields are `u64` on 64-bit targets and `u32` on 32-bit ones, so the
    // conversion is a no-op on some targets and widening on the rest.
    #[allow(clippy::useless_conversion)]
    let (blocks, block_bytes) = (u64::from(stat.f_bavail), u64::from(stat.f_frsize));
    Some(blocks.saturating_mul(block_bytes))
}

#[cfg(not(unix))]
fn free_space(_root: &Path) -> Option<u64> {
    None
}

fn spool_dir(root: &Path) -> PathBuf {
    root.join(IMPORTS)
}

impl Spools {
    const fn new() -> Self {
        Self {
            last_id: 0,
            imports: Vec::new(),
            dropped: 0,
        }
    }

    /// Frames dropped since this registry began.
    pub fn dropped(&self) -> u64 {
        self.dropped
    }

    /// Begin, or resume, the import of the archive `ask` names for `browser`.
    /// The answer's offset is the length of a spool of that digest already
    /// under `root`, 0 for a new one. Any import of the same digest begun
    /// before is replaced, so only the newest id takes frames. A browser has
    /// one import in flight: a begin for another digest is refused until that
    /// one is committed or cancelled. A begin whose bytes still to come do not
    /// fit in the free space less [`FREE_SPACE_MARGIN`] is refused.
    pub fn begin(&mut self, root: &Path, browser: &str, ask: &Begin) -> Result<Begun, String> {
        let free = free_space(root);
        self.begin_with_free(root, browser, ask, free)
    }

    /// [`Spools::begin`] with the free space on the volume given, `None` when
    /// it cannot be read, which skips that check.
    pub(crate) fn begin_with_free(
        &mut self,
        root: &Path,
        browser: &str,
        ask: &Begin,
        free: Option<u64>,
    ) -> Result<Begun, String> {
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

        if self
            .imports
            .iter()
            .any(|held| held.browser == browser && held.sha256 != ask.sha256)
        {
            return Err("another import from this browser is in progress".into());
        }
        let dir = spool_dir(root);
        let part = dir.join(format!("{}.part", ask.sha256));
        let on_disk = std::fs::metadata(&part)
            .map(|meta| meta.len())
            .ok()
            .filter(|len| *len <= ask.size)
            .unwrap_or(0);
        if free.is_some_and(|free| free.saturating_sub(FREE_SPACE_MARGIN) < ask.size - on_disk) {
            return Err("not enough free space on the phone for this archive".into());
        }
        self.imports.retain(|held| held.sha256 != ask.sha256);
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
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

    /// Take import `id` out of the registry for a commit, so the hash and the
    /// hand-over run without the registry held. An import not yet whole stays.
    fn take(&mut self, browser: &str, id: u32) -> Result<Import, String> {
        let at = self.position(browser, id)?;
        let import = &self.imports[at];
        if import.received != import.size {
            return Err(format!(
                "incomplete: {} of {} bytes",
                import.received, import.size
            ));
        }
        Ok(self.imports.remove(at))
    }

    /// Put back an import a commit took and did not finish. One whose spool is
    /// gone, or whose digest has since been begun again, is not put back.
    fn restore(&mut self, import: Import) {
        if import.part.exists() && self.imports.iter().all(|held| held.sha256 != import.sha256) {
            self.imports.push(import);
        }
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
        let import = self.take(browser, id)?;
        match finish(import, digest_of, hand_over) {
            Ok(ready) => Ok(ready),
            Err((kept, error)) => {
                if let Some(import) = kept {
                    self.restore(import);
                }
                Err(error)
            }
        }
    }

    /// Forget the imports `browser` began, deleting their spools. Imports of
    /// other browsers stay.
    pub fn forget(&mut self, browser: &str) {
        let (gone, kept): (Vec<Import>, Vec<Import>) = std::mem::take(&mut self.imports)
            .into_iter()
            .partition(|import| import.browser == browser);
        self.imports = kept;
        for import in gone {
            let _ = std::fs::remove_file(&import.part);
        }
    }

    /// Delete the spool of import `id`.
    pub fn cancel(&mut self, browser: &str, id: u32) -> Result<(), String> {
        let at = self.position(browser, id)?;
        let import = self.imports.remove(at);
        std::fs::remove_file(&import.part).map_err(|error| error.to_string())
    }
}

/// The commit of an import already taken out of the registry: hash its spool,
/// compare, rename and hand it over. On failure the import comes back with the
/// error when its spool is still whole enough to commit again.
fn finish(
    import: Import,
    digest: impl FnOnce(&Path) -> std::io::Result<[u8; 32]>,
    hand_over: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<PathBuf, (Option<Import>, String)> {
    let digest = match digest(&import.part) {
        Ok(digest) => digest,
        Err(error) => return Err((Some(import), error.to_string())),
    };
    if hex(&digest) != import.sha256 {
        let _ = std::fs::remove_file(&import.part);
        return Err((
            None,
            "checksum mismatch: the archive was not received intact".into(),
        ));
    }
    let ready = import.part.with_extension(import.extension);
    if let Err(error) = std::fs::rename(&import.part, &ready) {
        return Err((Some(import), error.to_string()));
    }
    if let Err(error) = hand_over(&ready) {
        return match std::fs::rename(&ready, &import.part) {
            Ok(()) => Err((Some(import), error)),
            Err(rename_error) => Err((None, rename_error.to_string())),
        };
    }
    Ok(ready)
}

/// [`Spools::commit`] on a shared registry, holding its lock only to take the
/// import out and to put it back: the hash of up to [`MAX_BYTES`] runs outside
/// it, so frames for every other import keep arriving meanwhile.
fn commit_shared(
    registry: &Mutex<Spools>,
    browser: &str,
    id: u32,
    digest: impl FnOnce(&Path) -> std::io::Result<[u8; 32]>,
    hand_over: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let lock = || registry.lock().unwrap_or_else(|e| e.into_inner());
    let import = lock().take(browser, id)?;
    finish(import, digest, hand_over).map_err(|(kept, error)| {
        if let Some(import) = kept {
            lock().restore(import);
        }
        error
    })
}

pub(super) fn digest_of(path: &Path) -> std::io::Result<[u8; 32]> {
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
    sweep_dir(&spool_dir(root), now)
}

/// Delete every file in `dir` that has not been written to for [`STALE_AFTER`]
/// before `now`. Returns how many were deleted.
pub(super) fn sweep_dir(dir: &Path, now: SystemTime) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
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
static SPOOLS: Mutex<Spools> = Mutex::new(Spools::new());

fn with_spools<R>(work: impl FnOnce(&mut Spools) -> R) -> R {
    let mut held = SPOOLS.lock().unwrap_or_else(|e| e.into_inner());
    work(&mut held)
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

/// Forget every import in progress without touching any file, so a test
/// starts with the registry empty.
#[cfg(test)]
pub(crate) fn reset_for_test() {
    with_spools(|spools| spools.imports.clear());
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
    commit_shared(&SPOOLS, browser, id, digest_of, |path| {
        if crate::net::import::start(install, path.to_path_buf()) {
            Ok(())
        } else {
            Err("an import or a Garmin pull is already running".to_owned())
        }
    })
    .map(drop)
}

/// Forget every import in progress that `browser` began, as an unlink does.
pub fn forget_browser(browser: &str) {
    with_spools(|spools| spools.forget(browser));
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
