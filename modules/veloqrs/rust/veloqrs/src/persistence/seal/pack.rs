//! Ride packs and the manifest that lists them: the sealed container's second
//! and third kinds.
//!
//! A pack is one calendar month of rides in one sealed object, and a manifest
//! is the sealed listing of a destination's packs. Both are sealed under the
//! data key alone, with no wrap in the header: the wraps live in the key file,
//! so a pack never carries a second copy of them to rewrap. The functions here
//! work on bytes and take their randomness through [`Randomness`], so the
//! golden vectors under `tests/fixtures/sealed/pack-v<N>/` pin the writers as
//! well as the readers.
//!
//! The pack's plaintext is a zip:
//!
//! ```text
//! pack.json                 the index, JSON (see `Index`)
//! <ride key>/original.fit   one entry per kind the index lists for the ride
//! <ride key>/streams.bin
//! ```
//!
//! and the manifest's plaintext is JSON, `{"format": 1, "packs": [...]}`. The
//! index and the manifest each carry their own format version, apart from the
//! container's: a reader dispatches on it and refuses a version it does not
//! know, and the version 1 reader stays in the tree for good.

use std::collections::BTreeSet;
use std::io::{Cursor, Read, Write};

use serde::{Deserialize, Serialize};

use super::layout::KEY_ID_LEN;
use super::{Dek, Kind, Randomness, SealError, Sealing, header, open_with_dek, seal};

/// The version of `pack.json` this build writes.
pub const PACK_FORMAT_VERSION: u16 = 1;
/// The version of the manifest listing this build writes.
pub const MANIFEST_FORMAT_VERSION: u16 = 1;

/// The largest inflated `pack.json` a reader accepts.
const INDEX_LIMIT: u64 = 16 * 1024 * 1024;
/// The largest inflated ride entry a reader accepts, far above any real ride,
/// so a small pack cannot inflate until the allocator aborts.
pub(super) const ENTRY_LIMIT: u64 = 512 * 1024 * 1024;
/// The largest manifest listing a reader accepts.
const MANIFEST_LIMIT: u64 = 64 * 1024 * 1024;
/// The longest ride key a pack names, in bytes.
const KEY_LIMIT: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PackError {
    #[error("{0}")]
    Seal(#[from] SealError),
    /// The container is a kind other than the one asked for. Nothing was
    /// authenticated or read.
    #[error("This sealed file is a {0:?} and cannot be read as the kind asked for")]
    WrongKind(Kind),
    #[error("The sealed ride pack is not valid: {0}")]
    Invalid(String),
}

fn invalid<T>(why: impl Into<String>) -> Result<T, PackError> {
    Err(PackError::Invalid(why.into()))
}

/// A calendar month, written `YYYY-MM`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Month {
    year: u16,
    month: u8,
}

impl std::str::FromStr for Month {
    type Err = String;

    fn from_str(text: &str) -> Result<Self, String> {
        let bytes = text.as_bytes();
        let shaped = bytes.len() == 7
            && bytes[4] == b'-'
            && bytes[..4].iter().chain(&bytes[5..]).all(u8::is_ascii_digit);
        if !shaped {
            return Err(format!("{text:?} is not a month written YYYY-MM"));
        }
        let year = text[..4].parse::<u16>().map_err(|e| e.to_string())?;
        let month = text[5..].parse::<u8>().map_err(|e| e.to_string())?;
        if !(1..=12).contains(&month) {
            return Err(format!("{text:?} is not a month of the year"));
        }
        Ok(Self { year, month })
    }
}

impl TryFrom<String> for Month {
    type Error = String;

    fn try_from(text: String) -> Result<Self, String> {
        text.parse()
    }
}

impl std::fmt::Display for Month {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:04}-{:02}", self.year, self.month)
    }
}

impl From<Month> for String {
    fn from(month: Month) -> String {
        month.to_string()
    }
}

/// What one entry of a ride holds. The name is the file name inside the ride's
/// directory of the zip, and a later kind is added to this list and never
/// changes what these mean.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntryKind {
    /// The recording as the device or service produced it.
    #[serde(rename = "original.fit")]
    OriginalFit,
    /// The engine's own binary encoding of the ride's streams.
    #[serde(rename = "streams.bin")]
    StreamsBin,
}

impl EntryKind {
    #[must_use]
    pub fn file_name(self) -> &'static str {
        match self {
            EntryKind::OriginalFit => "original.fit",
            EntryKind::StreamsBin => "streams.bin",
        }
    }

    /// Whether the bytes are already compressed, so the zip stores them as
    /// they are rather than deflating them again.
    fn precompressed(self) -> bool {
        matches!(self, EntryKind::StreamsBin)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RideEntry {
    pub kind: EntryKind,
    pub bytes: Vec<u8>,
}

/// One ride in a pack: the key it is known by, where it came from, when it
/// started and its entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackRide {
    pub key: String,
    pub source: String,
    pub start: String,
    pub entries: Vec<RideEntry>,
}

/// A pack read back: the key it was sealed under, its month and its rides in
/// the order they were written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pack {
    pub key_id: [u8; KEY_ID_LEN],
    pub month: Month,
    pub rides: Vec<PackRide>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    format: u16,
    month: Month,
    rides: Vec<IndexRide>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct IndexRide {
    key: String,
    source: String,
    start: String,
    kinds: Vec<EntryKind>,
}

/// One pack object as the manifest lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestPack {
    /// The object's name at the destination, which carries its month.
    pub name: String,
    pub month: Month,
    /// The object's length in bytes.
    pub bytes: u64,
    pub rides: u32,
    /// The ride keys in the pack, in the order the pack lists them.
    pub keys: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestFile {
    format: u16,
    packs: Vec<ManifestPack>,
}

/// A manifest read back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub key_id: [u8; KEY_ID_LEN],
    pub packs: Vec<ManifestPack>,
}

impl ManifestPack {
    /// The listing of a pack sealed under `key_id` for `month`, holding the
    /// rides `keys` name, `bytes` long.
    #[must_use]
    pub fn new(key_id: &[u8; KEY_ID_LEN], month: Month, keys: Vec<String>, bytes: u64) -> Self {
        Self {
            name: pack_name(key_id, month),
            month,
            bytes,
            rides: u32::try_from(keys.len()).unwrap_or(u32::MAX),
            keys,
        }
    }

    /// Refuse a pack this listing does not describe: another month, another
    /// key, other rides or another length. The manifest and the pack are two
    /// objects, and each is authenticated alone, so only this check ties them.
    ///
    /// # Errors
    ///
    /// Fails with the first disagreement between the listing and the pack.
    pub fn verify_pack(&self, pack: &Pack, byte_len: u64) -> Result<(), PackError> {
        if self.month != pack.month {
            return invalid(format!(
                "the manifest lists {} as {}, but the pack is {}",
                self.name, self.month, pack.month
            ));
        }
        if self.name != pack_name(&pack.key_id, pack.month) {
            return invalid(format!("{} is not this pack's name", self.name));
        }
        let keys: Vec<&str> = pack.rides.iter().map(|ride| ride.key.as_str()).collect();
        if self.keys != keys || self.rides as usize != keys.len() {
            return invalid(format!(
                "the rides in {} are not the ones listed",
                self.name
            ));
        }
        if self.bytes != byte_len {
            return invalid(format!("{} is not the length listed", self.name));
        }
        Ok(())
    }
}

/// Lowercase RFC 4648 base32 with no padding.
fn base32_lower(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut out = String::with_capacity((bytes.len() * 8).div_ceil(5));
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(char::from(ALPHABET[((buffer >> bits) & 31) as usize]));
        }
        buffer &= (1 << bits) - 1;
    }
    if bits > 0 {
        out.push(char::from(ALPHABET[((buffer << (5 - bits)) & 31) as usize]));
    }
    out
}

/// The name of the object holding `month`'s pack for the library whose data
/// key is `key_id`. It starts `veloq-pack-`, so a record listing never mistakes
/// it for a record zip.
#[must_use]
pub fn pack_name(key_id: &[u8; KEY_ID_LEN], month: Month) -> String {
    format!("veloq-pack-{}-{month}.sealed", base32_lower(key_id))
}

/// The name of the object holding the manifest for the library whose data key
/// is `key_id`.
#[must_use]
pub fn manifest_name(key_id: &[u8; KEY_ID_LEN]) -> String {
    format!("veloq-packs-{}.manifest.sealed", base32_lower(key_id))
}

/// A ride key is a directory name inside the zip, so it names one level of it.
fn check_key(key: &str) -> Result<(), PackError> {
    let bad = key.is_empty()
        || key.len() > KEY_LIMIT
        || key == "."
        || key == ".."
        || key.chars().any(|c| c == '/' || c == '\\' || c.is_control());
    if bad {
        return invalid(format!("{key:?} is not a ride key"));
    }
    Ok(())
}

/// Seal under the data key alone: the header carries the key id and the
/// derivation the key file's wraps share, and no wrap.
fn seal_bare(
    plaintext: &[u8],
    kind: Kind,
    sealing: &Sealing,
    rng: &mut dyn Randomness,
) -> Result<Vec<u8>, PackError> {
    let bare = Sealing {
        wraps: Vec::new(),
        ..sealing.clone()
    };
    Ok(seal(plaintext, kind, &bare, rng)?)
}

fn entry_path(key: &str, kind: EntryKind) -> String {
    format!("{key}/{}", kind.file_name())
}

fn zip_error(e: &impl std::fmt::Display) -> PackError {
    PackError::Invalid(format!("the pack's zip is not valid: {e}"))
}

/// Seal one month of rides.
///
/// Entry bytes are stored as they are when the kind is already compressed and
/// deflated otherwise. The rides are written in the order given.
///
/// # Errors
///
/// Fails on a pack of no rides, a ride with no entry, a key a reader could not
/// place, a key or a kind listed twice, or when sealing does.
pub fn write_pack(
    month: Month,
    rides: &[PackRide],
    sealing: &Sealing,
    rng: &mut dyn Randomness,
) -> Result<Vec<u8>, PackError> {
    if rides.is_empty() {
        return invalid("a pack holds at least one ride");
    }
    let mut keys = BTreeSet::new();
    let mut listed = Vec::with_capacity(rides.len());
    for ride in rides {
        check_key(&ride.key)?;
        if !keys.insert(ride.key.as_str()) {
            return invalid(format!("ride {} is listed twice", ride.key));
        }
        let kinds: Vec<EntryKind> = ride.entries.iter().map(|entry| entry.kind).collect();
        check_kinds(&ride.key, &kinds)?;
        listed.push(IndexRide {
            key: ride.key.clone(),
            source: ride.source.clone(),
            start: ride.start.clone(),
            kinds,
        });
    }
    let index = Index {
        format: PACK_FORMAT_VERSION,
        month,
        rides: listed,
    };

    let deflated = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));
    let stored =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("pack.json", deflated)
        .map_err(|e| zip_error(&e))?;
    serde_json::to_writer(&mut zip, &index).map_err(|e| PackError::Invalid(e.to_string()))?;
    for ride in rides {
        for entry in &ride.entries {
            let options = if entry.kind.precompressed() {
                stored
            } else {
                deflated
            };
            zip.start_file(entry_path(&ride.key, entry.kind), options)
                .map_err(|e| zip_error(&e))?;
            zip.write_all(&entry.bytes)
                .map_err(|e| PackError::Invalid(e.to_string()))?;
        }
    }
    let plaintext = zip.finish().map_err(|e| zip_error(&e))?.into_inner();
    seal_bare(&plaintext, Kind::Pack, sealing, rng)
}

fn check_kinds(key: &str, kinds: &[EntryKind]) -> Result<(), PackError> {
    if kinds.is_empty() {
        return invalid(format!("ride {key} has no entry"));
    }
    for (at, kind) in kinds.iter().enumerate() {
        if kinds[..at].contains(kind) {
            return invalid(format!("ride {key} lists {} twice", kind.file_name()));
        }
    }
    Ok(())
}

/// A header's kind, read before anything is authenticated, so a file of
/// another kind is refused without its payload being touched.
fn require_kind(bytes: &[u8], wanted: Kind) -> Result<(), PackError> {
    let found = header(bytes)?.kind;
    if found == wanted {
        Ok(())
    } else {
        Err(PackError::WrongKind(found))
    }
}

fn read_limited(source: impl Read, limit: u64, what: &str) -> Result<Vec<u8>, PackError> {
    let mut bytes = Vec::new();
    source
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| PackError::Invalid(format!("{what} could not be read: {e}")))?;
    if bytes.len() as u64 > limit {
        return invalid(format!("{what} is over the {limit} byte size limit"));
    }
    Ok(bytes)
}

fn read_entry<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>, PackError> {
    let entry = zip
        .by_name(name)
        .map_err(|e| PackError::Invalid(format!("{name} is missing from the pack: {e}")))?;
    if entry.size() > limit {
        return invalid(format!("{name} is over the {limit} byte size limit"));
    }
    read_limited(entry, limit, name)
}

/// Open a pack under the data key and read every ride out of it.
///
/// A file of another kind is refused by its header before the payload is read,
/// a wrong key or a changed byte fails authentication and yields nothing, and
/// an index that disagrees with the zip's entries is refused whole.
///
/// # Errors
///
/// Fails when the bytes are not a pack this build can read, the key does not
/// authenticate it, or the pack's index and entries disagree.
pub fn read_pack(bytes: &[u8], dek: &Dek) -> Result<Pack, PackError> {
    require_kind(bytes, Kind::Pack)?;
    let opened = open_with_dek(bytes, dek.clone())?;
    let mut zip = zip::ZipArchive::new(Cursor::new(opened.plaintext)).map_err(|e| zip_error(&e))?;
    let index: Index = serde_json::from_slice(&read_entry(&mut zip, "pack.json", INDEX_LIMIT)?)
        .map_err(|e| PackError::Invalid(format!("pack.json: {e}")))?;
    if index.format != PACK_FORMAT_VERSION {
        return invalid(format!("pack format {} is not supported", index.format));
    }
    if index.rides.is_empty() {
        return invalid("a pack holds at least one ride");
    }
    let listed: usize = index.rides.iter().map(|ride| ride.kinds.len()).sum();
    if zip.len() != listed + 1 {
        return invalid("the zip holds entries the index does not list, or lacks listed ones");
    }
    let mut keys = BTreeSet::new();
    let mut rides = Vec::with_capacity(index.rides.len());
    for ride in index.rides {
        check_key(&ride.key)?;
        if !keys.insert(ride.key.clone()) {
            return invalid(format!("ride {} is listed twice", ride.key));
        }
        check_kinds(&ride.key, &ride.kinds)?;
        let mut entries = Vec::with_capacity(ride.kinds.len());
        for kind in ride.kinds {
            let bytes = read_entry(&mut zip, &entry_path(&ride.key, kind), ENTRY_LIMIT)?;
            entries.push(RideEntry { kind, bytes });
        }
        rides.push(PackRide {
            key: ride.key,
            source: ride.source,
            start: ride.start,
            entries,
        });
    }
    Ok(Pack {
        key_id: opened.sealing.key_id,
        month: index.month,
        rides,
    })
}

/// A listing says what its own fields say: each pack's name is the one its key
/// and month give, its count is its keys, no month or ride key is listed twice.
fn check_listing(key_id: &[u8; KEY_ID_LEN], packs: &[ManifestPack]) -> Result<(), PackError> {
    let mut months = BTreeSet::new();
    let mut keys = BTreeSet::new();
    for pack in packs {
        if pack.name != pack_name(key_id, pack.month) {
            return invalid(format!(
                "{} is not the name of the {} pack",
                pack.name, pack.month
            ));
        }
        if pack.keys.is_empty() || pack.rides as usize != pack.keys.len() {
            return invalid(format!(
                "{} lists a ride count that is not its keys",
                pack.name
            ));
        }
        if !months.insert(pack.month) {
            return invalid(format!("month {} is listed twice", pack.month));
        }
        for key in &pack.keys {
            check_key(key)?;
            if !keys.insert(key.as_str()) {
                return invalid(format!("ride {key} is in two packs"));
            }
        }
    }
    Ok(())
}

/// Seal the listing of a destination's packs.
///
/// # Errors
///
/// Fails on a listing that contradicts itself or when sealing does.
pub fn write_manifest(
    packs: &[ManifestPack],
    sealing: &Sealing,
    rng: &mut dyn Randomness,
) -> Result<Vec<u8>, PackError> {
    check_listing(&sealing.key_id, packs)?;
    let file = ManifestFile {
        format: MANIFEST_FORMAT_VERSION,
        packs: packs.to_vec(),
    };
    let json = serde_json::to_vec(&file).map_err(|e| PackError::Invalid(e.to_string()))?;
    seal_bare(&json, Kind::Manifest, sealing, rng)
}

/// Open a manifest under the data key.
///
/// # Errors
///
/// Fails when the bytes are not a manifest this build can read, the key does
/// not authenticate it, or the listing contradicts itself.
pub fn read_manifest(bytes: &[u8], dek: &Dek) -> Result<Manifest, PackError> {
    require_kind(bytes, Kind::Manifest)?;
    let opened = open_with_dek(bytes, dek.clone())?;
    let json = read_limited(opened.plaintext.as_slice(), MANIFEST_LIMIT, "the manifest")?;
    let file: ManifestFile = serde_json::from_slice(&json)
        .map_err(|e| PackError::Invalid(format!("the manifest: {e}")))?;
    if file.format != MANIFEST_FORMAT_VERSION {
        return invalid(format!("manifest format {} is not supported", file.format));
    }
    let key_id = opened.sealing.key_id;
    check_listing(&key_id, &file.packs)?;
    Ok(Manifest {
        key_id,
        packs: file.packs,
    })
}

#[cfg(test)]
#[path = "pack_tests.rs"]
mod tests;
