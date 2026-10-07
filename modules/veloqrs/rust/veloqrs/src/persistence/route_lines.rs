//! The route-line layer: every route's line, encoded once when the groups are
//! written and read by the map in one primary-key statement.
//!
//! The layer is one row of `route_line_layer`, stamped with the route group
//! generation it was built from. Every group write rebuilds it inside its own
//! transaction, after advancing the generation, so a read that finds the stamp
//! equal to the generation holds lines for exactly the committed groups. A
//! writer that forgets the rebuild leaves the stamp behind, and the read then
//! returns no lines rather than lines for groups that are gone.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};
use serde::{Deserialize, Serialize};

use super::codec;
use super::route_identity::read_group_generation;

/// The fewest activities a group needs to count as a route, the routes list's
/// floor and the one every route count reads: a group of one ride is not a
/// route the athlete repeats.
pub(crate) const MIN_ROUTE_ACTIVITIES: u32 = 2;

/// The layer blob's shape version. postcard is positional, so a blob of
/// another shape reads as no layer and the next rebuild replaces it.
const LAYER_VERSION: u8 = 1;

/// One route's line as the map draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct RouteLine {
    pub(crate) route_id: String,
    /// The number the route is shown under, absent until one is minted.
    pub(crate) number: Option<u32>,
    /// The representative's signature, in `codec::encode_polyline` form.
    pub(crate) polyline: Vec<u8>,
}

fn encode_layer(lines: &[RouteLine]) -> SqlResult<Vec<u8>> {
    codec::serialize(lines)
        .map(|body| codec::tag_blob(LAYER_VERSION, body))
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))
}

fn decode_layer(blob: &[u8]) -> Option<Vec<RouteLine>> {
    let body = codec::untag_blob(LAYER_VERSION, blob)?;
    match codec::deserialize(body) {
        Ok(lines) => Some(lines),
        Err(error) => {
            log::warn!("[route_lines] layer unreadable, read as none: {error}");
            None
        }
    }
}

/// The representative's signature encoded for drawing, or `None` when the
/// activity has no stored signature, which leaves the route undrawn.
fn representative_line(conn: &Connection, representative_id: &str) -> Option<Vec<u8>> {
    super::activities::pooled::signature(conn, representative_id)
        .map(|signature| crate::persistence::codec::encode_polyline(&signature.points))
}

fn write_layer(conn: &Connection, generation: u64, lines: &[RouteLine]) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO route_line_layer (id, generation, route_count, layer)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
             generation = excluded.generation,
             route_count = excluded.route_count,
             layer = excluded.layer",
        params![generation as i64, lines.len() as i64, encode_layer(lines)?],
    )?;
    Ok(())
}

/// The stored layer and the generation it was stamped with, whether or not
/// that generation is current. `None` when there is no row or it is unreadable.
fn stored_layer(conn: &Connection) -> SqlResult<Option<(u64, Vec<RouteLine>)>> {
    let row = conn
        .prepare_cached("SELECT generation, layer FROM route_line_layer WHERE id = 1")?
        .query_row([], |row| {
            Ok((row.get::<_, i64>(0)? as u64, row.get::<_, Vec<u8>>(1)?))
        })
        .optional()?;
    Ok(row.and_then(|(generation, blob)| decode_layer(&blob).map(|lines| (generation, lines))))
}

/// Build the whole layer from the stored groups and stamp it with the current
/// generation. Every group with at least [`MIN_ROUTE_ACTIVITIES`] activities and
/// a stored representative signature gets one line, in route id order. The
/// caller runs this inside the transaction that wrote the groups, after the
/// generation advance.
pub(crate) fn rebuild(conn: &Connection) -> SqlResult<usize> {
    let generation = read_group_generation(conn)?;
    let numbers = super::routes::stored_route_numbers(conn)?;
    let mut groups = super::routes::pooled::group_keys(conn, false, false);
    groups.retain(|group| group.activity_count >= MIN_ROUTE_ACTIVITIES);
    groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
    let lines: Vec<RouteLine> = groups
        .into_iter()
        .filter_map(|group| {
            let polyline = representative_line(conn, &group.representative_id)?;
            Some(RouteLine {
                number: numbers.get(&group.group_id).copied(),
                route_id: group.group_id,
                polyline,
            })
        })
        .collect();
    write_layer(conn, generation, &lines)?;
    Ok(lines.len())
}

/// Replace one route's line after its representative changed, and stamp the
/// layer with the current generation. `before` is the generation the write
/// advanced from: a layer stamped with anything else, or one that does not
/// draw this route, is rebuilt whole instead, so the patch never carries
/// another writer's lines forward.
pub(crate) fn replace_representative(
    conn: &Connection,
    route_id: &str,
    representative_id: &str,
    before: u64,
) -> SqlResult<()> {
    let Some((stamp, mut lines)) = stored_layer(conn)? else {
        return rebuild(conn).map(|_| ());
    };
    let Some(at) = lines.iter().position(|line| line.route_id == route_id) else {
        return rebuild(conn).map(|_| ());
    };
    if stamp != before {
        return rebuild(conn).map(|_| ());
    }
    match representative_line(conn, representative_id) {
        Some(polyline) => lines[at].polyline = polyline,
        None => {
            lines.remove(at);
        }
    }
    write_layer(conn, read_group_generation(conn)?, &lines)
}

/// Empty the layer, for a write that deletes the groups without advancing
/// the generation.
pub(crate) fn clear(conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM route_line_layer", [])?;
    Ok(())
}

/// Rebuild the layer when it is missing, unreadable or stamped with an older
/// generation. Run on the foreground load, which is the backfill for a library
/// that has groups and no layer yet.
pub(crate) fn ensure_current(conn: &Connection) -> SqlResult<()> {
    if pooled::layer(conn)?.is_none() {
        rebuild(conn)?;
    }
    Ok(())
}

/// Layer reads that need no engine, only its database.
pub(crate) mod pooled {
    use super::*;

    /// The route lines for the committed groups, or `None` when the layer is
    /// missing, unreadable or was built from another generation.
    pub(crate) fn layer_with_generation(
        conn: &Connection,
    ) -> SqlResult<Option<(u64, Vec<RouteLine>)>> {
        let generation = read_group_generation(conn)?;
        Ok(stored_layer(conn)?.filter(|(stamp, _)| *stamp == generation))
    }

    /// How many routes the current layer draws, from the one row's count
    /// column and without decoding the blob. Zero when the layer is missing
    /// or stale.
    pub(crate) fn route_count(conn: &Connection) -> SqlResult<u32> {
        let generation = read_group_generation(conn)?;
        let count = conn
            .prepare_cached(
                "SELECT route_count FROM route_line_layer WHERE id = 1 AND generation = ?1",
            )?
            .query_row(params![generation as i64], |row| row.get::<_, i64>(0))
            .optional()?;
        Ok(count.unwrap_or(0) as u32)
    }

    pub(crate) fn layer(conn: &Connection) -> SqlResult<Option<Vec<RouteLine>>> {
        let generation = read_group_generation(conn)?;
        Ok(stored_layer(conn)?
            .filter(|(stamp, _)| *stamp == generation)
            .map(|(_, lines)| lines))
    }
}

#[cfg(test)]
#[path = "tests/route_lines.rs"]
mod tests;
