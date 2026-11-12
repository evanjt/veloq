//! How a bounding box crosses the link: as `minLat`, `maxLat`, `minLng` and
//! `maxLng`.
//!
//! The matcher's own box serialises with snake_case names. A record the link
//! carries names [`option`] with `#[serde(with = "crate::remote::bounds::option")]`
//! on its `Option<Bounds>` field, and one that is always there names this
//! module itself, so the page reads one camelCase shape.

use serde::{Deserialize, Serialize};
use tracematch::Bounds;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Wire {
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
}

impl From<&Bounds> for Wire {
    fn from(bounds: &Bounds) -> Self {
        Self {
            min_lat: bounds.min_lat,
            max_lat: bounds.max_lat,
            min_lng: bounds.min_lng,
            max_lng: bounds.max_lng,
        }
    }
}

impl From<Wire> for Bounds {
    fn from(wire: Wire) -> Self {
        Self {
            min_lat: wire.min_lat,
            max_lat: wire.max_lat,
            min_lng: wire.min_lng,
            max_lng: wire.max_lng,
        }
    }
}

/// Write `bounds` as a camelCase record.
pub fn serialize<S: serde::Serializer>(bounds: &Bounds, serializer: S) -> Result<S::Ok, S::Error> {
    Wire::from(bounds).serialize(serializer)
}

/// Read a camelCase record back.
pub fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Bounds, D::Error> {
    Wire::deserialize(deserializer).map(Bounds::from)
}

/// A box that may be absent: `null` when it is.
pub mod option {
    use super::{Bounds, Deserialize, Serialize, Wire};
    use serde::{Deserializer, Serializer};

    /// Write `bounds` as a camelCase record, or `null`.
    pub fn serialize<S: Serializer>(
        bounds: &Option<Bounds>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        bounds.as_ref().map(Wire::from).serialize(serializer)
    }

    /// Read a camelCase record or `null` back.
    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Bounds>, D::Error> {
        Option::<Wire>::deserialize(deserializer).map(|wire| wire.map(Bounds::from))
    }
}

#[cfg(test)]
#[path = "tests/bounds.rs"]
mod tests;
