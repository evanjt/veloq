use serde::{Deserialize, Serialize, de::DeserializeOwned};

/// Serialize a type that is postcard-safe (no skip_serializing_if on any fields).
/// Used for Vec<u32>, simple numeric arrays, etc.
pub fn serialize<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, String> {
    postcard::to_allocvec(value).map_err(|e| e.to_string())
}

/// Deserialize a type that may be in postcard or legacy rmp-serde format.
/// Tries postcard first, falls back to rmp-serde for existing data.
pub fn deserialize<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    postcard::from_bytes(bytes)
        .map_err(|e| e.to_string())
        .or_else(|_| rmp_serde::from_slice(bytes).map_err(|e| e.to_string()))
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
/// not match `version` — the caller treats None like a missing blob and reseeds.
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
    postcard::to_allocvec(&compact).map_err(|e| e.to_string())
}

pub fn deserialize_points(bytes: &[u8]) -> Result<Vec<crate::GpsPoint>, String> {
    if let Ok(compact) = postcard::from_bytes::<Vec<CompactGpsPoint>>(bytes) {
        return Ok(compact
            .into_iter()
            .map(|p| crate::GpsPoint {
                latitude: p.latitude,
                longitude: p.longitude,
                elevation: p.elevation,
            })
            .collect());
    }
    rmp_serde::from_slice(bytes).map_err(|e| e.to_string())
}

/// Types containing GpsPoint (like ConsensusAccumulator) can't use postcard
/// due to skip_serializing_if on GpsPoint.elevation. Use rmp-serde for these,
/// but try postcard first on read for forward compatibility.
pub fn serialize_gps_composite<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    rmp_serde::to_vec(value).map_err(|e| e.to_string())
}

pub fn deserialize_gps_composite<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    rmp_serde::from_slice(bytes).map_err(|e| e.to_string())
}

/// Placeholder written to the NOT NULL `sections.polyline_json` column. The
/// blob is the authoritative geometry; only rows written before blob authority
/// carry real JSON, which readers use as a fallback.
pub const NO_POLYLINE_JSON: &str = "";

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
// the polyline byte-identically. Each version is stored independently
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
}
