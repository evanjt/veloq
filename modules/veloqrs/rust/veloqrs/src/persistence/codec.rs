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
