//! The place names the geocoder answered, one per cell of the map.
//!
//! The provider's terms ask for every answer to be kept, so a cell asked once
//! is answered from here for good. The geocoder itself is `net::geocode`.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

/// Cells per degree. 1/200 of a degree is about 550 m of latitude: fine
/// enough that a cell sits inside one suburb or village, coarse enough that
/// the rides of one area share a handful of them.
const CELLS_PER_DEGREE: f64 = 200.0;

/// One cell of the map, as whole steps of latitude and longitude.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PlaceCell {
    pub lat: i32,
    pub lng: i32,
}

impl PlaceCell {
    /// The cell a point falls in.
    pub fn of(lat: f64, lng: f64) -> Self {
        Self {
            lat: (lat * CELLS_PER_DEGREE).round() as i32,
            lng: (lng * CELLS_PER_DEGREE).round() as i32,
        }
    }

    /// The point the cell is asked about. The cell's centre rather than the
    /// ride's own point, so what leaves the device is no finer than the answer
    /// is kept at.
    pub fn centre(self) -> (f64, f64) {
        (
            f64::from(self.lat) / CELLS_PER_DEGREE,
            f64::from(self.lng) / CELLS_PER_DEGREE,
        )
    }
}

/// What is kept for a cell in a language: `None` when it was never asked,
/// `Some(None)` when it was asked and the answer carried no place.
pub fn cached_place(
    conn: &Connection,
    cell: PlaceCell,
    language: &str,
) -> SqlResult<Option<Option<String>>> {
    conn.query_row(
        "SELECT name FROM geocoded_places
         WHERE lat_cell = ? AND lng_cell = ? AND language = ?",
        params![cell.lat, cell.lng, language],
        |row| row.get(0),
    )
    .optional()
}

/// Keep an answer, replacing any held for the cell in that language.
pub fn store_place(
    conn: &Connection,
    cell: PlaceCell,
    language: &str,
    name: Option<&str>,
    answered_at_ms: i64,
) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO geocoded_places (lat_cell, lng_cell, language, name, answered_at)
         VALUES (?, ?, ?, ?, ?)",
        params![cell.lat, cell.lng, language, name, answered_at_ms],
    )?;
    Ok(())
}
