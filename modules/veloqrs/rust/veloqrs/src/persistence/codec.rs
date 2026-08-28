use serde::{Deserialize, Serialize, de::DeserializeOwned};

/// Format tag prefixed to every postcard blob on write. 0xC1 is the one byte
/// the msgpack spec reserves as never used, so a framed blob can never begin a
/// legacy rmp-serde payload. The 4-byte length after the tag pins the payload,
/// so a legacy blob that happens to start with 0xC1 cannot slip through the
/// framed path by accident. Distinct from the one-byte struct-version
/// [`tag_blob`], which sits inside a body whose format is already known.
const POSTCARD_TAG: u8 = 0xC1;

fn frame_postcard(payload: Vec<u8>) -> Vec<u8> {
    let Ok(len) = u32::try_from(payload.len()) else {
        // Oversized payload: write unframed, still readable via the fallback.
        return payload;
    };
    let mut out = Vec::with_capacity(payload.len() + 5);
    out.push(POSTCARD_TAG);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&payload);
    out
}

fn unframe_postcard(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.len() < 5 || bytes[0] != POSTCARD_TAG {
        return None;
    }
    let len = u32::from_le_bytes(bytes[1..5].try_into().ok()?) as usize;
    let payload = &bytes[5..];
    (payload.len() == len).then_some(payload)
}

/// Postcard decode that rejects trailing bytes. postcard::from_bytes ignores
/// leftover input, which lets a legacy rmp blob misparse as a shorter postcard
/// value with garbage contents; requiring full consumption closes that hole.
fn postcard_exact<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    match postcard::take_from_bytes(bytes) {
        Ok((value, rest)) if rest.is_empty() => Ok(value),
        Ok(_) => Err("postcard decode left trailing bytes".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// Serialize a type that is postcard-safe (no skip_serializing_if on any fields).
/// Used for Vec<u32>, simple numeric arrays, etc.
pub fn serialize<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, String> {
    postcard::to_allocvec(value)
        .map(frame_postcard)
        .map_err(|e| e.to_string())
}

/// Deserialize a blob written by `serialize`, falling back to the legacy
/// unframed formats (postcard, then rmp-serde) for pre-tag data.
pub fn deserialize<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    if let Some(payload) = unframe_postcard(bytes) {
        if let Ok(value) = postcard_exact(payload) {
            return Ok(value);
        }
    }
    postcard_exact(bytes).or_else(|_| rmp_serde::from_slice(bytes).map_err(|e| e.to_string()))
}

/// Prefix a serialised body with a one-byte version tag. postcard is positional,
/// not self-describing, so a struct shape change would misparse an old blob;
/// the tag lets a reader detect the mismatch and heal (reseed) instead. Used for
/// the persisted identity-registry blobs (B4 migration 013).
pub fn tag_blob(version: u8, mut body: Vec<u8>) -> Vec<u8> {
    body.insert(0, version);
    body
}

/// The body of a version-tagged blob, or None if the tag byte is absent or does
/// not match `version`, the caller treats None like a missing blob and reseeds.
pub fn untag_blob(version: u8, bytes: &[u8]) -> Option<&[u8]> {
    match bytes.split_first() {
        Some((&v, rest)) if v == version => Some(rest),
        _ => None,
    }
}

/// GpsPoint wrapper that always serializes elevation (no skip_serializing_if).
/// GpsPoint in tracematch uses #[serde(skip_serializing_if = "Option::is_none")]
/// on elevation, which breaks postcard (a non-self-describing format).
#[derive(Serialize, Deserialize)]
struct CompactGpsPoint {
    latitude: f64,
    longitude: f64,
    elevation: Option<f64>,
}

pub fn serialize_points(points: &[crate::GpsPoint]) -> Result<Vec<u8>, String> {
    let compact: Vec<CompactGpsPoint> = points
        .iter()
        .map(|p| CompactGpsPoint {
            latitude: p.latitude,
            longitude: p.longitude,
            elevation: p.elevation,
        })
        .collect();
    postcard::to_allocvec(&compact)
        .map(frame_postcard)
        .map_err(|e| e.to_string())
}

/// Leading byte of an rmp-serde sequence: fixarray, array16 or array32. Every
/// legacy point blob is a sequence, so any other leading byte means the blob is
/// not rmp and the fallback must not be attempted on it.
fn is_rmp_array_header(b: u8) -> bool {
    matches!(b, 0x90..=0x9f | 0xdc | 0xdd)
}

/// rmp decode that rejects trailing bytes. A quantised polyline whose leading
/// varint lands in the fixarray range would otherwise decode as a short array
/// and silently return the wrong points.
fn rmp_exact<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    let mut de = rmp_serde::Deserializer::new(std::io::Cursor::new(bytes));
    let value = T::deserialize(&mut de).map_err(|e| e.to_string())?;
    let consumed = de.position() as usize;
    if consumed == bytes.len() {
        Ok(value)
    } else {
        Err(format!(
            "rmp decode left {} trailing bytes",
            bytes.len() - consumed
        ))
    }
}

/// Decode a stored point blob, trying framed postcard, unframed postcard and
/// rmp-serde in that order. On failure the error names the containers that were
/// tried and what each said, plus the blob length and its first byte, so a log
/// line is enough to identify the format. A blob claimed by no container (the
/// quantised polyline stream carries no version byte, it opens on a varint
/// count) reports as unrecognised rather than as a postcard error.
pub fn deserialize_points(bytes: &[u8]) -> Result<Vec<crate::GpsPoint>, String> {
    let expand = |compact: Vec<CompactGpsPoint>| -> Vec<crate::GpsPoint> {
        compact
            .into_iter()
            .map(|p| crate::GpsPoint {
                latitude: p.latitude,
                longitude: p.longitude,
                elevation: p.elevation,
            })
            .collect()
    };
    let Some(&first) = bytes.first() else {
        return Err("empty blob, 0 B".to_string());
    };

    let mut steps: Vec<String> = Vec::new();
    let mut claimed = false;

    if first == POSTCARD_TAG {
        claimed = true;
        match unframe_postcard(bytes) {
            Some(payload) => match postcard_exact::<Vec<CompactGpsPoint>>(payload) {
                Ok(compact) => return Ok(expand(compact)),
                Err(e) => steps.push(format!("framed postcard body: {}", e)),
            },
            None => steps.push("framed postcard: length prefix disagrees with payload".to_string()),
        }
    }

    match postcard_exact::<Vec<CompactGpsPoint>>(bytes) {
        Ok(compact) => return Ok(expand(compact)),
        Err(e) => steps.push(format!("unframed postcard: {}", e)),
    }

    if is_rmp_array_header(first) {
        claimed = true;
        match rmp_exact::<Vec<crate::GpsPoint>>(bytes) {
            Ok(points) => return Ok(points),
            Err(e) => steps.push(format!("rmp-serde: {}", e)),
        }
    } else {
        steps.push("rmp-serde: not attempted, no array header".to_string());
    }

    let lead = if claimed {
        "every container rejected the blob"
    } else {
        "unrecognised container"
    };
    Err(format!(
        "{}, first byte 0x{:02x}, {} B: {}",
        lead,
        first,
        bytes.len(),
        steps.join("; ")
    ))
}

// ------------------------------------------------- track reads

/// The outcome of reading one stored track. `Missing` is the absence of a row,
/// `Corrupt` is a row whose bytes did not decode. The reason names the failed
/// decode step, the blob length and the first byte, and carries no coordinate,
/// so it is safe to log.
#[derive(Debug, Clone, PartialEq)]
pub enum TrackRead {
    Present(Vec<crate::GpsPoint>),
    Missing,
    Corrupt(String),
}

impl TrackRead {
    /// Classify a stored blob. A row always holds bytes, so this never yields
    /// `Missing`.
    pub fn from_blob(bytes: &[u8]) -> Self {
        match deserialize_points(bytes) {
            Ok(points) => TrackRead::Present(points),
            Err(reason) => TrackRead::Corrupt(reason),
        }
    }

    /// The points, or an empty slice for a missing or corrupt read.
    pub fn points(&self) -> &[crate::GpsPoint] {
        match self {
            TrackRead::Present(points) => points,
            _ => &[],
        }
    }

    /// Degrade to `Option` for callers that still return one, logging the
    /// reason at warn first so a corrupt row is not indistinguishable from an
    /// activity that was never synced.
    pub fn into_option(self, context: &str, activity_id: &str) -> Option<Vec<crate::GpsPoint>> {
        match self {
            TrackRead::Present(points) => Some(points),
            TrackRead::Missing => None,
            TrackRead::Corrupt(reason) => {
                log::warn!(
                    "[{}] activity {}: corrupt stored points, {}",
                    context,
                    activity_id,
                    reason
                );
                None
            }
        }
    }
}

/// What one full walk over the stored tracks saw. `failed` counts rows the
/// driver could not hand over at all, so a caller can say its result is
/// incomplete instead of reporting a short list as the whole library.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TrackWalk {
    /// Rows handed to the callback, corrupt ones included.
    pub visited: usize,
    /// Rows whose bytes did not decode.
    pub corrupt: usize,
    /// Rows lost to a query or column-read failure.
    pub failed: usize,
}

impl TrackWalk {
    /// True when the walk did not see every stored row.
    pub fn is_incomplete(&self) -> bool {
        self.failed > 0
    }
}

/// Types containing GpsPoint (like ConsensusAccumulator) can't use postcard
/// due to skip_serializing_if on GpsPoint.elevation. Use rmp-serde for these.
/// Single-format both ways, so no frame is needed: there is no fallback that
/// could misparse a foreign blob.
pub fn serialize_gps_composite<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    rmp_serde::to_vec(value).map_err(|e| e.to_string())
}

/// Encode a value whose graph contains `skip_serializing_if` fields.
///
/// [`serialize_gps_composite`] writes structs as positional arrays, so a
/// skipped field shortens the array and every field after it decodes as the
/// wrong type. Naming the fields costs bytes and buys a decode that survives
/// an absent `Option` anywhere in the graph. Read back with
/// [`deserialize_gps_composite`], which accepts both shapes.
pub fn serialize_named<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    rmp_serde::to_vec_named(value).map_err(|e| e.to_string())
}

pub fn deserialize_gps_composite<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    rmp_serde::from_slice(bytes).map_err(|e| e.to_string())
}

/// What every write puts in `sections.polyline_json`. The blob is the
/// authoritative geometry; only rows written before blob authority carry
/// real JSON, which readers use as a fallback.
pub const NO_POLYLINE_JSON: Option<&str> = None;

/// Decode a section polyline row: blob first (authoritative), JSON fallback for
/// legacy rows. A decodable blob always wins; the JSON path only runs when the
/// blob is missing or corrupt.
pub fn decode_polyline_row(
    blob: Option<&[u8]>,
    json: Option<&str>,
) -> Result<Vec<crate::GpsPoint>, String> {
    if let Some(bytes) = blob {
        match deserialize_points(bytes) {
            Ok(points) => return Ok(points),
            Err(e) => log::warn!(
                "decode_polyline_row: blob decode failed ({}); trying JSON fallback",
                e
            ),
        }
    }
    match json {
        Some(j) if !j.trim().is_empty() => {
            serde_json::from_str(j).map_err(|e| format!("polyline JSON decode failed: {}", e))
        }
        _ => Err("no stored polyline (blob missing and JSON empty)".to_string()),
    }
}

// ------------------------------------------------- quantised polylines
// `section_geometry` (encoding 1). Corpus-measured (lab geometry_codec,
// REPORT round 10): ~3.1 B/point vs ~62 B/point JSON, and 1e-6 deg
// quantisation is exact on real 6-decimal exports, so a revert restores
// the line a rider follows. Elevation quantises to 0.1 m, so a revert
// restores a height to a decimetre and not to the stored f64. Comparison
// is encoded bytes against encoded bytes, so neither flaps. Each version
// is stored independently
// (no cross-version delta chains): the 10-year retention budget holds
// without them, every row decodes alone, and a quarantine salvage
// cannot lose a version to a torn predecessor.

/// Lat/lng counts per degree: 1e-6 deg, ~0.11 m worst case.
const POLYLINE_SCALE: f64 = 1e6;
/// Elevation counts per metre: 0.1 m.
const ELEVATION_SCALE: f64 = 10.0;

/// Elevation carriage in the stream header.
const ELE_NONE: u8 = 0;
const ELE_ALL: u8 = 1;
const ELE_MIXED: u8 = 2;

fn zigzag(v: i64) -> u64 {
    ((v << 1) ^ (v >> 63)) as u64
}

fn unzigzag(v: u64) -> i64 {
    ((v >> 1) as i64) ^ -((v & 1) as i64)
}

fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            break;
        }
        out.push(b | 0x80);
    }
}

fn read_varint(bytes: &[u8], pos: &mut usize) -> Option<u64> {
    let mut v = 0u64;
    let mut shift = 0u32;
    loop {
        let b = *bytes.get(*pos)?;
        *pos += 1;
        v |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Some(v);
        }
        if shift >= 63 {
            return None;
        }
        shift += 7;
    }
}

/// Quantised zigzag-varint polyline stream: point count, elevation mode
/// (none / all / mixed with a presence bitmap), then per point the deltas of
/// the quantised lat, lng, and (where present) elevation. Exact on 6-decimal
/// coordinates and 0.1 m elevations; None elevations survive as None.
pub fn encode_polyline(points: &[crate::GpsPoint]) -> Vec<u8> {
    let mut out = Vec::new();
    write_varint(&mut out, points.len() as u64);
    let with_ele = points.iter().filter(|p| p.elevation.is_some()).count();
    let mode = match with_ele {
        0 => ELE_NONE,
        n if n == points.len() => ELE_ALL,
        _ => ELE_MIXED,
    };
    out.push(mode);
    if mode == ELE_MIXED {
        let mut bitmap = vec![0u8; points.len().div_ceil(8)];
        for (i, p) in points.iter().enumerate() {
            if p.elevation.is_some() {
                bitmap[i / 8] |= 1 << (i % 8);
            }
        }
        out.extend_from_slice(&bitmap);
    }
    let (mut plat, mut plng, mut pele) = (0i64, 0i64, 0i64);
    for p in points {
        let lat = (p.latitude * POLYLINE_SCALE).round() as i64;
        let lng = (p.longitude * POLYLINE_SCALE).round() as i64;
        write_varint(&mut out, zigzag(lat - plat));
        write_varint(&mut out, zigzag(lng - plng));
        plat = lat;
        plng = lng;
        if mode != ELE_NONE
            && let Some(e) = p.elevation
        {
            let e = (e * ELEVATION_SCALE).round() as i64;
            write_varint(&mut out, zigzag(e - pele));
            pele = e;
        }
    }
    out
}

/// Decode [`encode_polyline`] output. None on any truncated or malformed
/// stream; never panics on foreign bytes.
pub fn decode_polyline(bytes: &[u8]) -> Option<Vec<crate::GpsPoint>> {
    let mut pos = 0usize;
    let n = usize::try_from(read_varint(bytes, &mut pos)?).ok()?;
    // A varint can claim an absurd count; bound by what the remaining bytes
    // could possibly hold (2 varint bytes per point minimum).
    if n > bytes.len().saturating_sub(pos).saturating_mul(8) {
        return None;
    }
    let mode = *bytes.get(pos)?;
    pos += 1;
    let bitmap: &[u8] = if mode == ELE_MIXED {
        let len = n.div_ceil(8);
        let b = bytes.get(pos..pos + len)?;
        pos += len;
        b
    } else {
        &[]
    };
    let mut points = Vec::with_capacity(n);
    let (mut lat, mut lng, mut ele) = (0i64, 0i64, 0i64);
    for i in 0..n {
        lat += unzigzag(read_varint(bytes, &mut pos)?);
        lng += unzigzag(read_varint(bytes, &mut pos)?);
        let has_ele = match mode {
            ELE_ALL => true,
            ELE_MIXED => bitmap[i / 8] & (1 << (i % 8)) != 0,
            _ => false,
        };
        let elevation = if has_ele {
            ele += unzigzag(read_varint(bytes, &mut pos)?);
            Some(ele as f64 / ELEVATION_SCALE)
        } else {
            None
        };
        points.push(crate::GpsPoint {
            latitude: lat as f64 / POLYLINE_SCALE,
            longitude: lng as f64 / POLYLINE_SCALE,
            elevation,
        });
    }
    Some(points)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::GpsPoint;

    fn pt(lat: f64, lng: f64, ele: Option<f64>) -> GpsPoint {
        GpsPoint {
            latitude: lat,
            longitude: lng,
            elevation: ele,
        }
    }

    /// A realistic 6-decimal line, built the way real data arrives: parsed
    /// from decimal strings. On such doubles the round-trip is bit-exact
    /// (correctly-rounded division by an exact 1e6 lands on the same
    /// nearest-double the parser picked), not merely within tolerance.
    #[test]
    fn polyline_round_trips_exactly_on_six_decimal_coordinates() {
        let dec = |v: f64, places: usize| -> f64 { format!("{v:.places$}").parse().unwrap() };
        let points: Vec<GpsPoint> = (0..500)
            .map(|i| {
                pt(
                    dec(46.0 + (i as f64) * 0.000_09, 6),
                    dec(7.0 - (i as f64) * 0.000_113, 6),
                    Some(dec(500.0 + (i as f64) * 0.7, 1)),
                )
            })
            .collect();
        let bytes = encode_polyline(&points);
        assert_eq!(decode_polyline(&bytes).unwrap(), points);
        assert!(
            bytes.len() < points.len() * 8,
            "the stream must stay in the measured few-bytes-per-point band, got {} B for {} points",
            bytes.len(),
            points.len()
        );
    }

    #[test]
    fn polyline_without_elevation_round_trips() {
        let points = vec![pt(46.2, 7.36, None), pt(46.200_51, 7.360_72, None)];
        assert_eq!(decode_polyline(&encode_polyline(&points)).unwrap(), points);
    }

    /// Mixed elevation presence: None points must come back as None, not 0.0.
    #[test]
    fn mixed_elevation_presence_survives() {
        let points = vec![
            pt(46.2, 7.36, Some(512.3)),
            pt(46.200_51, 7.360_72, None),
            pt(46.201_02, 7.361_44, Some(514.8)),
            pt(46.201_53, 7.362_16, None),
        ];
        assert_eq!(decode_polyline(&encode_polyline(&points)).unwrap(), points);
    }

    #[test]
    fn empty_and_single_point_round_trip() {
        assert_eq!(decode_polyline(&encode_polyline(&[])).unwrap(), vec![]);
        let one = vec![pt(-37.813_6, 144.963_1, Some(31.0))];
        assert_eq!(decode_polyline(&encode_polyline(&one)).unwrap(), one);
    }

    #[test]
    fn foreign_bytes_decode_to_none_not_panic() {
        assert!(decode_polyline(&[]).is_none());
        assert!(decode_polyline(&[0xff; 32]).is_none());
        assert!(decode_polyline(b"not a polyline").is_none());
        let mut truncated = encode_polyline(&[pt(46.2, 7.36, Some(500.0))]);
        truncated.truncate(truncated.len() - 1);
        assert!(decode_polyline(&truncated).is_none());
    }

    // ------------------------------------------- postcard framing

    fn framing_points() -> Vec<GpsPoint> {
        vec![pt(46.2276, 7.3589, Some(512.0)), pt(46.2301, 7.3612, None)]
    }

    fn compact(points: &[GpsPoint]) -> Vec<CompactGpsPoint> {
        points
            .iter()
            .map(|p| CompactGpsPoint {
                latitude: p.latitude,
                longitude: p.longitude,
                elevation: p.elevation,
            })
            .collect()
    }

    #[test]
    fn framed_round_trip() {
        let original: Vec<u32> = vec![0, 1, 127, 128, 300, u32::MAX];
        let blob = serialize(&original).unwrap();
        assert_eq!(blob[0], POSTCARD_TAG);
        let decoded: Vec<u32> = deserialize(&blob).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn framed_points_round_trip() {
        let original = framing_points();
        let blob = serialize_points(&original).unwrap();
        assert_eq!(blob[0], POSTCARD_TAG);
        let decoded = deserialize_points(&blob).unwrap();
        assert_eq!(decoded.len(), original.len());
        assert_eq!(decoded[0].latitude, original[0].latitude);
        assert_eq!(decoded[1].elevation, None);
    }

    #[test]
    fn legacy_unframed_postcard_blob_decodes() {
        let original: Vec<u32> = vec![10, 20, 30];
        let legacy = postcard::to_allocvec(&original).unwrap();
        let decoded: Vec<u32> = deserialize(&legacy).unwrap();
        assert_eq!(decoded, original);

        let legacy_points = postcard::to_allocvec(&compact(&framing_points())).unwrap();
        assert_eq!(deserialize_points(&legacy_points).unwrap().len(), 2);
    }

    #[test]
    fn legacy_rmp_blob_decodes() {
        let original: Vec<u32> = vec![10, 200, 70000];
        let legacy = rmp_serde::to_vec(&original).unwrap();
        let decoded: Vec<u32> = deserialize(&legacy).unwrap();
        assert_eq!(decoded, original);

        let with_elevation: Vec<GpsPoint> = framing_points()
            .into_iter()
            .map(|mut p| {
                p.elevation = Some(400.0);
                p
            })
            .collect();
        let legacy_points = rmp_serde::to_vec(&with_elevation).unwrap();
        let decoded = deserialize_points(&legacy_points).unwrap();
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].elevation, Some(400.0));
    }

    /// Scenario: a legacy rmp array16 blob whose bytes also parse as a shorter
    /// postcard Vec<u32> when trailing input is ignored.
    /// Expected behaviour: the exact-consumption guard rejects the postcard
    /// misparse and the rmp fallback returns the true contents.
    #[test]
    fn legacy_rmp_blob_never_misparsed_as_postcard() {
        let original: Vec<u32> = vec![1; 300];
        let legacy = rmp_serde::to_vec(&original).unwrap();

        // Prove the ambiguity is real: trailing-tolerant postcard accepts these
        // bytes as a different, garbage vector.
        let misparse = postcard::from_bytes::<Vec<u32>>(&legacy).unwrap();
        assert_ne!(misparse, original);

        let decoded: Vec<u32> = deserialize(&legacy).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn trailing_bytes_rejected() {
        let mut framed = serialize(&vec![1u32, 2, 3]).unwrap();
        framed.extend_from_slice(&[0xFF, 0xFF]);
        assert!(deserialize::<Vec<u32>>(&framed).is_err());

        let mut unframed = postcard::to_allocvec(&compact(&framing_points())).unwrap();
        unframed.extend_from_slice(&[0xFF, 0xFF]);
        assert!(deserialize_points(&unframed).is_err());
    }

    #[test]
    fn truncated_framed_blob_errors_instead_of_garbage() {
        let blob = serialize_points(&framing_points()).unwrap();
        assert!(deserialize_points(&blob[..blob.len() - 1]).is_err());
    }

    #[test]
    fn tampered_frame_length_errors_instead_of_garbage() {
        let mut blob = serialize(&vec![1u32, 2, 3]).unwrap();
        blob[1] = blob[1].wrapping_add(1);
        assert!(deserialize::<Vec<u32>>(&blob).is_err());
    }

    /// The struct-version tag and the postcard frame are independent layers:
    /// framing a body must not disturb `tag_blob`/`untag_blob`.
    #[test]
    fn version_tag_and_postcard_frame_compose() {
        let body = serialize(&vec![7u32, 8, 9]).unwrap();
        let tagged = tag_blob(3, body);
        assert_eq!(tagged[0], 3);
        assert!(untag_blob(4, &tagged).is_none());
        let payload = untag_blob(3, &tagged).expect("version 3 body");
        assert_eq!(deserialize::<Vec<u32>>(payload).unwrap(), vec![7, 8, 9]);
    }

    /// The quantised polyline codec is its own format with its own framing and
    /// must stay readable alongside the postcard tag.
    #[test]
    fn quantised_polyline_is_untouched_by_framing() {
        let points = framing_points();
        let quantised = encode_polyline(&points);
        assert_ne!(
            quantised.first(),
            Some(&POSTCARD_TAG),
            "the quantised stream is not postcard and must not be framed"
        );
        assert_eq!(decode_polyline(&quantised).unwrap().len(), points.len());
    }

    fn sample_section() -> crate::FrequentSection {
        let polyline = vec![
            crate::GpsPoint::with_elevation(45.0, 8.0, 400.0),
            crate::GpsPoint::with_elevation(45.001, 8.0, 405.0),
        ];
        crate::FrequentSection {
            id: "sec_1".to_string(),
            name: None,
            sport_type: "Ride".to_string(),
            distance_meters: 111.0,
            point_density: vec![2; polyline.len()],
            polyline,
            representative_activity_id: String::new(),
            representative_range: None,
            activity_ids: vec![],
            activity_portions: vec![],
            route_ids: vec![],
            visit_count: 0,
            activity_traces: std::collections::HashMap::new(),
            confidence: 0.9,
            observation_count: 3,
            average_spread: 4.0,
            scale: None,
            is_user_defined: false,
            stability: 1.0,
            elevation_gain_m: Some(12.0),
            avg_grade_percent: Some(1.5),
            version: 7,
            updated_at: None,
            created_at: None,
            enrichment: Default::default(),
            rank: None,
            consensus_state: None,
        }
    }

    /// A `skip_serializing_if` field is safe in a positional encoding only
    /// when nothing follows it. `FrequentSection` skips `elevation_gain_m`
    /// and `avg_grade_percent` and then declares `version: u32`, so a section
    /// with no elevation writes a short array and `version` reads whatever
    /// came next. `GpsPoint` skips `elevation` last, which is why it survives.
    #[test]
    fn a_section_without_elevation_needs_the_named_encoding() {
        let section = crate::FrequentSection {
            elevation_gain_m: None,
            avg_grade_percent: None,
            ..sample_section()
        };

        let positional = serialize_gps_composite(&section).expect("encode");
        assert!(
            deserialize_gps_composite::<crate::FrequentSection>(&positional).is_err(),
            "the positional encoding round-tripped, so this rule has changed \
             and every caller that relies on it should be revisited"
        );

        let named = serialize_named(&section).expect("encode");
        let back = deserialize_gps_composite::<crate::FrequentSection>(&named)
            .expect("the named encoding survives the skipped fields");
        assert_eq!(back.id, section.id);
        assert_eq!(back.version, section.version);
    }

    #[test]
    fn a_trailing_skipped_field_survives_either_encoding() {
        let points = vec![crate::GpsPoint::new(45.0, 8.0); 3];
        let positional = serialize_gps_composite(&points).expect("encode");
        assert_eq!(
            deserialize_gps_composite::<Vec<crate::GpsPoint>>(&positional)
                .expect("elevation is the last field")
                .len(),
            3
        );
    }
}
