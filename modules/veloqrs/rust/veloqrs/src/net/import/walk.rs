//! The entries of a collection, one at a time.
//!
//! A collection is a directory, a file, or an archive of any of them: a `.zip`
//! whose entries may be `.zip`s or gzipped files in turn. An archive is read
//! through its central directory and an entry is read into memory only when it
//! is the next one to import, never the archive whole.
//!
//! Every file that is not a container is one entry, numbered from zero in a
//! fixed order (directories by name, archives in their own order, a nested
//! archive in place), so a count of entries is a place in the walk that a later
//! walk of the same collection reaches again. Entries before `resume_at` are
//! numbered and not read.
//!
//! An entry is named by its extension and then, when the extension is not one
//! it knows, by the `.FIT` magic at byte 8 of the file header, so a misnamed
//! ride is tried and a file that is nothing the import reads is skipped rather
//! than failed.

use crate::remote::digest::Sha256Stream;
use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek};
use std::ops::ControlFlow;
use std::path::Path;

/// The most one entry may inflate to. The largest ride file measured is
/// 1.4 MB, so this refuses an archive built to exhaust memory and nothing an
/// athlete recorded.
pub(super) const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;

/// The most the nested archives of one walk may hold in memory at once, at
/// every depth together. An inner archive is read whole while the archive that
/// holds it is still held, so a cap per level alone would multiply by depth.
const MAX_NESTED_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;

/// Archives inside archives, counting the outermost.
const MAX_DEPTH: u32 = 4;

/// What one entry is, and the bytes of a FIT.
#[derive(Debug)]
pub(super) enum Entry {
    /// A file to decode as a FIT, or the reason it could not be read.
    Fit {
        name: String,
        bytes: Result<Vec<u8>, String>,
    },
    /// A GPX or TCX file, or the reason it could not be read.
    OtherFormat {
        name: String,
        bytes: Result<Vec<u8>, String>,
    },
    /// Not a ride and not a format the import knows.
    Skipped { name: String },
}

/// Why the walk could not go on.
#[derive(Debug)]
pub(super) struct WalkError(pub String);

impl From<std::io::Error> for WalkError {
    fn from(e: std::io::Error) -> Self {
        Self(e.to_string())
    }
}

/// What a name says an entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Named {
    Zip,
    Gzip,
    Fit,
    Other,
    Unknown,
}

fn named(name: &str) -> Named {
    let lower = name.to_ascii_lowercase();
    let ends = |suffix: &str| lower.ends_with(suffix);
    if ends(".zip") {
        Named::Zip
    } else if ends(".gz") {
        Named::Gzip
    } else if ends(".fit") {
        Named::Fit
    } else if ends(".gpx") || ends(".tcx") {
        Named::Other
    } else {
        Named::Unknown
    }
}

/// Junk a platform leaves in an archive, which is not part of the collection.
fn is_litter(name: &str) -> bool {
    let base = name.rsplit('/').next().unwrap_or(name);
    name.starts_with("__MACOSX/") || base.starts_with("._") || base == ".DS_Store"
}

fn has_fit_magic(prefix: &[u8]) -> bool {
    prefix.get(8..12) == Some(b".FIT")
}

/// Whether the head of a file opens a GPX or a TCX document.
pub(super) fn has_xml_ride_root(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(2048)];
    let contains = |needle: &[u8]| head.windows(needle.len()).any(|w| w == needle);
    contains(b"<gpx") || contains(b"<TrainingCenterDatabase")
}

fn read_capped(reader: &mut dyn Read, limit: u64) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes)?;
    Ok((bytes.len() as u64 <= limit).then_some(bytes))
}

struct Walk<'a> {
    index: u64,
    resume_at: u64,
    visit: &'a mut dyn FnMut(u64, Entry) -> ControlFlow<()>,
    /// What nested archives may hold at once, and what they hold now.
    budget: u64,
    held: u64,
    peak: u64,
}

impl Walk<'_> {
    /// Hand one entry over, or pass it when the walk is not there yet.
    fn emit(&mut self, entry: impl FnOnce() -> Entry) -> ControlFlow<()> {
        let index = self.index;
        self.index += 1;
        if index < self.resume_at {
            return ControlFlow::Continue(());
        }
        (self.visit)(index, entry())
    }

    /// A file on disk or an entry of an archive, whose bytes `reader` gives.
    fn entry(
        &mut self,
        name: &str,
        reader: &mut dyn Read,
        depth: u32,
    ) -> Result<ControlFlow<()>, WalkError> {
        if is_litter(name) {
            return Ok(ControlFlow::Continue(()));
        }
        Ok(match named(name) {
            Named::Zip => self.archive_in_memory(name, reader, depth)?,
            Named::Gzip => self.gzipped(name, reader, depth)?,
            Named::Fit => self.emit(|| fit_entry(name, reader)),
            Named::Other => self.emit(|| other_entry(name, reader)),
            Named::Unknown => self.emit(|| sniffed(name, reader)),
        })
    }

    fn archive_in_memory(
        &mut self,
        name: &str,
        reader: &mut dyn Read,
        depth: u32,
    ) -> Result<ControlFlow<()>, WalkError> {
        if depth >= MAX_DEPTH {
            return Ok(self.emit(|| failed(name, "archives nest deeper than the import reads")));
        }
        let room = self.budget - self.held;
        match read_capped(reader, room) {
            Ok(Some(bytes)) => {
                let charged = bytes.len() as u64;
                self.held += charged;
                self.peak = self.peak.max(self.held);
                let flow = self.archive(name, Cursor::new(bytes), depth + 1);
                self.held -= charged;
                flow
            }
            Ok(None) => {
                Ok(self.emit(|| failed(name, "the archive is larger than the import reads")))
            }
            Err(e) => Ok(self.emit(|| failed(name, &e.to_string()))),
        }
    }

    fn gzipped(
        &mut self,
        name: &str,
        reader: &mut dyn Read,
        depth: u32,
    ) -> Result<ControlFlow<()>, WalkError> {
        let inner = &name[..name.len() - ".gz".len()];
        if named(inner) == Named::Zip {
            let mut inflated = flate2::read::GzDecoder::new(reader);
            return self.archive_in_memory(inner, &mut inflated, depth);
        }
        Ok(self.emit(|| {
            let mut inflated = flate2::read::GzDecoder::new(reader);
            let bytes = match read_capped(&mut inflated, MAX_ENTRY_BYTES) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => return failed(name, "the file inflates past what the import reads"),
                Err(e) => return failed(name, &format!("the gzip did not inflate: {e}")),
            };
            match named(inner) {
                Named::Other => Entry::OtherFormat {
                    name: name.to_string(),
                    bytes: Ok(bytes),
                },
                Named::Fit => Entry::Fit {
                    name: name.to_string(),
                    bytes: Ok(bytes),
                },
                _ if has_fit_magic(&bytes) => Entry::Fit {
                    name: name.to_string(),
                    bytes: Ok(bytes),
                },
                _ if has_xml_ride_root(&bytes) => Entry::OtherFormat {
                    name: name.to_string(),
                    bytes: Ok(bytes),
                },
                _ => Entry::Skipped {
                    name: name.to_string(),
                },
            }
        }))
    }

    fn archive<R: Read + Seek>(
        &mut self,
        label: &str,
        source: R,
        depth: u32,
    ) -> Result<ControlFlow<()>, WalkError> {
        let mut archive = match zip::ZipArchive::new(source) {
            Ok(archive) => archive,
            Err(e) => {
                return Ok(self.emit(|| failed(label, &format!("the archive did not open: {e}"))));
            }
        };
        for i in 0..archive.len() {
            let inner = archive.name_for_index(i).and_then(Result::ok);
            if inner.as_deref().is_some_and(|n| n.ends_with('/')) {
                continue;
            }
            let entry_name = match inner {
                Some(name) => format!("{label}/{name}"),
                None => format!("{label}/entry {i}"),
            };
            let mut file = match archive.by_index(i) {
                Ok(file) => file,
                Err(e) => {
                    let flow =
                        self.emit(|| failed(&entry_name, &format!("the entry did not open: {e}")));
                    if flow.is_break() {
                        return Ok(flow);
                    }
                    continue;
                }
            };
            if file.size() > self.budget {
                let flow =
                    self.emit(|| failed(&entry_name, "the entry is larger than the import reads"));
                if flow.is_break() {
                    return Ok(flow);
                }
                continue;
            }
            let flow = self.entry(&entry_name, &mut file, depth)?;
            if flow.is_break() {
                return Ok(flow);
            }
        }
        Ok(ControlFlow::Continue(()))
    }

    fn directory(&mut self, dir: &Path, depth: u32) -> Result<ControlFlow<()>, WalkError> {
        let mut paths: Vec<_> = std::fs::read_dir(dir)?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|e| e.path())
            .collect();
        paths.sort();
        for path in paths {
            let flow = self.path(&path, depth)?;
            if flow.is_break() {
                return Ok(flow);
            }
        }
        Ok(ControlFlow::Continue(()))
    }

    fn path(&mut self, path: &Path, depth: u32) -> Result<ControlFlow<()>, WalkError> {
        let meta = std::fs::symlink_metadata(path)?;
        if meta.is_dir() {
            return self.directory(path, depth);
        }
        if !meta.is_file() {
            return Ok(ControlFlow::Continue(()));
        }
        let name = path.to_string_lossy().into_owned();
        if is_litter(&name) {
            return Ok(ControlFlow::Continue(()));
        }
        if named(&name) == Named::Zip {
            let file = File::open(path)?;
            return self.archive(&name, BufReader::new(file), depth + 1);
        }
        match File::open(path) {
            Ok(file) => self.entry(&name, &mut BufReader::new(file), depth),
            Err(e) => Ok(self.emit(|| failed(&name, &e.to_string()))),
        }
    }
}

fn failed(name: &str, reason: &str) -> Entry {
    Entry::Fit {
        name: name.to_string(),
        bytes: Err(reason.to_string()),
    }
}

fn fit_entry(name: &str, reader: &mut dyn Read) -> Entry {
    match read_capped(reader, MAX_ENTRY_BYTES) {
        Ok(Some(bytes)) => Entry::Fit {
            name: name.to_string(),
            bytes: Ok(bytes),
        },
        Ok(None) => failed(name, "the file is larger than the import reads"),
        Err(e) => failed(name, &e.to_string()),
    }
}

fn other_entry(name: &str, reader: &mut dyn Read) -> Entry {
    let bytes = match read_capped(reader, MAX_ENTRY_BYTES) {
        Ok(Some(bytes)) => Ok(bytes),
        Ok(None) => Err("the file is larger than the import reads".to_string()),
        Err(e) => Err(e.to_string()),
    };
    Entry::OtherFormat {
        name: name.to_string(),
        bytes,
    }
}

/// An entry whose name says nothing: a FIT by its header, a GPX or TCX by the
/// root element at its head, else not a ride.
fn sniffed(name: &str, reader: &mut dyn Read) -> Entry {
    let skipped = || Entry::Skipped {
        name: name.to_string(),
    };
    let mut prefix = Vec::new();
    if reader.take(2048).read_to_end(&mut prefix).is_err() {
        return skipped();
    }
    let fit = has_fit_magic(&prefix);
    if !fit && !has_xml_ride_root(&prefix) {
        return skipped();
    }
    match read_capped(reader, MAX_ENTRY_BYTES) {
        Ok(Some(rest)) => {
            prefix.extend_from_slice(&rest);
            if fit {
                Entry::Fit {
                    name: name.to_string(),
                    bytes: Ok(prefix),
                }
            } else {
                Entry::OtherFormat {
                    name: name.to_string(),
                    bytes: Ok(prefix),
                }
            }
        }
        Ok(None) => failed(name, "the file is larger than the import reads"),
        Err(e) => failed(name, &e.to_string()),
    }
}

/// Walk the collection at `root` from entry `resume_at`, handing each entry
/// to `visit` with its number until it breaks.
pub(super) fn walk(
    root: &Path,
    resume_at: u64,
    visit: &mut dyn FnMut(u64, Entry) -> ControlFlow<()>,
) -> Result<ControlFlow<()>, WalkError> {
    walk_within(root, resume_at, MAX_NESTED_ARCHIVE_BYTES, visit).0
}

/// [`walk`] under a given nested-archive budget, with the most bytes the
/// nested archives held at once.
pub(super) fn walk_within(
    root: &Path,
    resume_at: u64,
    budget: u64,
    visit: &mut dyn FnMut(u64, Entry) -> ControlFlow<()>,
) -> (Result<ControlFlow<()>, WalkError>, u64) {
    let mut walk = Walk {
        index: 0,
        resume_at,
        visit,
        budget,
        held: 0,
        peak: 0,
    };
    let flow = walk.path(root, 0);
    (flow, walk.peak)
}

/// What the collection is, so a checkpoint is read back only against the same
/// one: the digest of a file's bytes, and for a directory the digest of every
/// file's relative path and size.
pub(super) fn identity(root: &Path) -> Result<String, WalkError> {
    let mut digest = Sha256Stream::new();
    if std::fs::metadata(root)?.is_dir() {
        let mut listing = Vec::new();
        list(root, root, &mut listing)?;
        listing.sort();
        for (relative, size) in listing {
            digest.update(format!("{relative}\t{size}\n").as_bytes());
        }
    } else {
        let mut file = BufReader::new(File::open(root)?);
        let mut block = vec![0u8; 64 * 1024];
        loop {
            let read = file.read(&mut block)?;
            if read == 0 {
                break;
            }
            digest.update(&block[..read]);
        }
    }
    Ok(digest.finish().iter().map(|b| format!("{b:02x}")).collect())
}

fn list(root: &Path, dir: &Path, out: &mut Vec<(String, u64)>) -> Result<(), WalkError> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let meta = std::fs::symlink_metadata(&path)?;
        if meta.is_dir() {
            list(root, &path, out)?;
        } else if meta.is_file() {
            let relative = path.strip_prefix(root).unwrap_or(&path);
            out.push((relative.to_string_lossy().into_owned(), meta.len()));
        }
    }
    Ok(())
}
