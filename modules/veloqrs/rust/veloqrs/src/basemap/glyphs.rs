//! Glyph ranges the app does not bundle.
//!
//! The app carries the Latin ranges of its label stacks and answers them from
//! its own assets. A label stack names the app's face first and a Noto face
//! after it for the glyphs the app's face lacks, and the page asks for the
//! stack as the names joined with commas. Every other range (CJK, Arabic,
//! Devanagari) is the Noto face's alone: it is fetched from the glyph host on
//! the first miss and kept in the tile store, so a label in another script
//! draws online and again offline once it has been seen. The app's face has
//! no host, so a range of it the bundle lacks is a glyph file with no glyph in
//! it, which the renderer reads as nothing to draw rather than as a failure.
//!
//! The page chooses the font stack and the range, so both are checked against
//! what the host serves before the store or the network is touched: a name the
//! page invented would otherwise become a directory and a request.

use super::{NO_TILE, TileFetchError, TileStore, page_status};

/// The stacks the glyph host serves, with the source name each is kept under.
const STACKS: [(&str, &str); 2] = [
    ("Noto Sans Regular", "glyphs-noto-sans-regular"),
    ("Noto Sans Bold", "glyphs-noto-sans-bold"),
];

/// The faces the app carries and the host does not serve.
const BUNDLED_ONLY: [&str; 2] = ["Manrope Regular", "Manrope Bold"];

/// Where the glyph ranges are fetched from.
const GLYPH_HOST: &str = "https://tiles.openfreemap.org/fonts";

/// The extension a kept range is stored under.
const EXTENSION: &str = "pbf";

/// A glyph range holds 256 code points, and the Basic Multilingual Plane has
/// 256 of them.
const RANGE_WIDTH: u32 = 256;
const RANGE_COUNT: u32 = 256;

/// A request for one glyph range that names a stack and a range the host
/// serves, and where each is kept.
#[derive(Debug, PartialEq, Eq)]
struct GlyphKey {
    source: &'static str,
    index: u32,
    url: String,
}

/// The start and end of a range, when it is `<start>-<end>` in decimal with
/// `start` a multiple of 256 and `end` 255 above it, written as the host
/// writes it.
fn range_bounds(range: &str) -> Option<(u32, u32)> {
    let (start, end) = range.split_once('-')?;
    let digits = |text: &str| {
        !text.is_empty() && text.len() <= 5 && text.bytes().all(|b| b.is_ascii_digit())
    };
    if !digits(start) || !digits(end) {
        return None;
    }
    let (start, end): (u32, u32) = (start.parse().ok()?, end.parse().ok()?);
    if start % RANGE_WIDTH != 0
        || end != start + RANGE_WIDTH - 1
        || start / RANGE_WIDTH >= RANGE_COUNT
    {
        return None;
    }
    Some((start, end))
}

/// The stack and range the page asked for, or `None` when either is not one
/// the host serves.
fn key_for(fontstack: &str, range: &str) -> Option<GlyphKey> {
    let (_, source) = STACKS.iter().find(|(name, _)| *name == fontstack)?;
    let (start, end) = range_bounds(range)?;
    Some(GlyphKey {
        source,
        index: start / RANGE_WIDTH,
        url: format!(
            "{GLYPH_HOST}/{}/{start}-{end}.{EXTENSION}",
            fontstack.replace(' ', "%20")
        ),
    })
}

/// The face of a stack the host serves, or `None` when every face is one only
/// the app carries. `Err` when the stack names a face that is neither.
fn hosted_face(fontstack: &str) -> Result<Option<&str>, ()> {
    let mut hosted = None;
    for face in fontstack.split(',') {
        if STACKS.iter().any(|(name, _)| *name == face) {
            hosted = Some(face);
        } else if !BUNDLED_ONLY.contains(&face) {
            return Err(());
        }
    }
    Ok(hosted)
}

/// Appends `value` as a protobuf varint.
fn put_varint(out: &mut Vec<u8>, mut value: usize) {
    while value >= 0x80 {
        out.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

/// Appends field `field` as a length-delimited protobuf field.
fn put_bytes(out: &mut Vec<u8>, field: u8, bytes: &[u8]) {
    out.push((field << 3) | 2);
    put_varint(out, bytes.len());
    out.extend_from_slice(bytes);
}

/// A glyph range file with no glyph in it: one `glyphs` message whose one
/// fontstack names the stack and the range.
fn empty_range(fontstack: &str, range: &str) -> Vec<u8> {
    let mut stack = Vec::new();
    put_bytes(&mut stack, 1, fontstack.as_bytes());
    put_bytes(&mut stack, 2, range.as_bytes());
    let mut out = Vec::new();
    put_bytes(&mut out, 1, &stack);
    out
}

/// What the page is told when the glyph host cannot be reached. A range that
/// is neither held nor fetchable is not a failure of the host: the label falls
/// back to the device's font, which is what offline already means.
fn glyph_status(error: &TileFetchError) -> u16 {
    match error {
        TileFetchError::Unreachable(_) => NO_TILE,
        other => page_status(other),
    }
}

/// One glyph range's bytes: the range of the stack's hosted face from the
/// store when it is there, otherwise from `fetch`, kept for next time, or an
/// empty range when no face of the stack is hosted. Errors are the status the
/// page is answered with.
pub(crate) fn range_with(
    store: &TileStore,
    fontstack: &str,
    range: &str,
    fetch: impl FnOnce(&str) -> Result<Vec<u8>, TileFetchError>,
) -> Result<Vec<u8>, u16> {
    let Some(face) = hosted_face(fontstack).map_err(|()| NO_TILE)? else {
        range_bounds(range).ok_or(NO_TILE)?;
        return Ok(empty_range(fontstack, range));
    };
    let key = key_for(face, range).ok_or(NO_TILE)?;
    if let Some(bytes) = store.get(key.source, 0, key.index, 0) {
        return Ok(bytes);
    }
    let bytes = fetch(&key.url).map_err(|e| {
        log::warn!(
            "[basemap] glyphs {} {} did not fetch: {}",
            fontstack,
            range,
            e
        );
        glyph_status(&e)
    })?;
    if let Err(e) = store.put(key.source, 0, key.index, 0, EXTENSION, &bytes, false) {
        // The range is still good to draw even if it could not be kept.
        log::warn!(
            "[basemap] glyphs {} {} did not store: {}",
            fontstack,
            range,
            e
        );
    }
    Ok(bytes)
}

/// [`range_with`] against the app's store and the interactive fetcher.
pub(crate) fn range_bytes(fontstack: &str, range: &str) -> Result<Vec<u8>, u16> {
    let store = super::store().ok_or(NO_TILE)?;
    range_with(&store, fontstack, range, |url| {
        let fetcher = super::INTERACTIVE
            .as_ref()
            .ok_or_else(|| TileFetchError::Unreachable("no tile client".to_string()))?;
        crate::runtime::block_on(fetcher.fetch(url))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const CJK: &str = "19968-20223";

    fn rejected(status: u16) -> TileFetchError {
        TileFetchError::Rejected { status }
    }

    #[test]
    fn an_unbundled_range_is_fetched_online_and_kept() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        let got = range_with(&store, "Noto Sans Regular", CJK, |url| {
            assert_eq!(
                url,
                "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/19968-20223.pbf"
            );
            Ok(vec![1, 2, 3])
        });
        assert_eq!(got, Ok(vec![1, 2, 3]));

        let offline = range_with(&store, "Noto Sans Regular", CJK, |_| {
            Err(TileFetchError::Unreachable("offline".to_string()))
        });
        assert_eq!(
            offline,
            Ok(vec![1, 2, 3]),
            "the second ask is served from the store"
        );
    }

    #[test]
    fn an_unbundled_range_never_seen_is_404_offline() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        let got = range_with(&store, "Noto Sans Bold", CJK, |_| {
            Err(TileFetchError::Unreachable("offline".to_string()))
        });
        assert_eq!(got, Err(404));
    }

    #[test]
    fn a_host_refusal_reaches_the_page_and_nothing_is_kept() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        assert_eq!(
            range_with(&store, "Noto Sans Bold", CJK, |_| Err(rejected(429))),
            Err(429)
        );
        assert_eq!(
            range_with(&store, "Noto Sans Bold", CJK, |_| Err(rejected(500))),
            Err(502)
        );
        assert_eq!(
            range_with(&store, "Noto Sans Bold", CJK, |_| Err(
                TileFetchError::Empty
            )),
            Err(404)
        );
        assert_eq!(store.get("glyphs-noto-sans-bold", 0, 78, 0), None);
    }

    #[test]
    fn stacks_are_kept_apart() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        range_with(&store, "Noto Sans Regular", CJK, |_| Ok(vec![1])).unwrap();
        let bold = range_with(&store, "Noto Sans Bold", CJK, |_| Ok(vec![2]));
        assert_eq!(bold, Ok(vec![2]));
    }

    #[test]
    fn a_stack_or_range_the_host_does_not_serve_is_refused_before_any_fetch() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        let never = |_: &str| -> Result<Vec<u8>, TileFetchError> { panic!("must not fetch") };
        for (stack, range) in [
            ("../outside", CJK),
            ("Comic Sans", CJK),
            ("Noto Sans Regular", "19969-20224"),
            ("Noto Sans Regular", "19968-20224"),
            ("Noto Sans Regular", "65536-65791"),
            ("Noto Sans Regular", "../0-255"),
            ("Noto Sans Regular", "0-255.pbf"),
            ("Noto Sans Regular", "-"),
            ("Noto Sans Regular", ""),
        ] {
            assert_eq!(
                range_with(&store, stack, range, never),
                Err(404),
                "{stack} {range}"
            );
        }
    }

    #[test]
    fn a_label_stack_is_answered_from_its_fallback_face_and_kept_with_it() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        let got = range_with(&store, "Manrope Bold,Noto Sans Bold", CJK, |url| {
            assert_eq!(
                url,
                "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/19968-20223.pbf"
            );
            Ok(vec![4, 5])
        });
        assert_eq!(got, Ok(vec![4, 5]));
        assert_eq!(
            range_with(&store, "Noto Sans Bold", CJK, |_| Err(
                TileFetchError::Unreachable("offline".to_string())
            )),
            Ok(vec![4, 5]),
            "the fallback face's range is kept once for every stack that names it"
        );
    }

    #[test]
    fn an_unbundled_range_of_a_face_with_no_host_is_an_empty_glyph_file() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        let never = |_: &str| -> Result<Vec<u8>, TileFetchError> { panic!("must not fetch") };
        let got = range_with(&store, "Manrope Regular", CJK, never).unwrap();
        // One `glyphs` message holding one fontstack that names the stack and
        // the range and carries no glyph.
        let name = b"Manrope Regular";
        let range = CJK.as_bytes();
        let mut stack = vec![0x0a, name.len() as u8];
        stack.extend_from_slice(name);
        stack.extend_from_slice(&[0x12, range.len() as u8]);
        stack.extend_from_slice(range);
        let mut expected = vec![0x0a, stack.len() as u8];
        expected.extend_from_slice(&stack);
        assert_eq!(got, expected);
    }

    #[test]
    fn a_label_stack_naming_a_face_the_app_does_not_know_is_refused() {
        let dir = TempDir::new().unwrap();
        let store = TileStore::new(dir.path());
        let never = |_: &str| -> Result<Vec<u8>, TileFetchError> { panic!("must not fetch") };
        for (stack, range) in [
            ("Manrope Italic,Noto Sans Regular", CJK),
            ("Manrope Regular,Comic Sans", CJK),
            ("Manrope Regular,", CJK),
            (",Noto Sans Regular", CJK),
            ("Manrope Regular", "19969-20224"),
            ("Manrope Regular,Noto Sans Regular", "0-255.pbf"),
        ] {
            assert_eq!(
                range_with(&store, stack, range, never),
                Err(404),
                "{stack} {range}"
            );
        }
    }

    #[test]
    fn the_last_range_of_the_plane_is_served() {
        assert!(key_for("Noto Sans Regular", "65280-65535").is_some());
    }
}
