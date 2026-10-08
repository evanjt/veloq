-- The name the geocoder gave each route and section that appeared while
-- geocoding was on, kept apart from any name the athlete typed, so a typed
-- name is never replaced and a geocoded one can stop showing when geocoding
-- is turned off.
--
-- A row is written when the engine first numbers the item with geocoding on,
-- which queues it, and the naming pass settles it once.
CREATE TABLE IF NOT EXISTS geocoded_names (
    -- 'route' or 'section'.
    kind TEXT NOT NULL CHECK (kind IN ('route', 'section')),
    item_id TEXT NOT NULL,

    -- The name put together from the start and end places. NULL while the
    -- item is queued, and after a lookup that found no place or failed,
    -- which is not asked again.
    name TEXT,

    -- When the item was queued, in epoch milliseconds.
    queued_at INTEGER NOT NULL,

    -- When the lookup settled it, in epoch milliseconds. NULL while queued.
    named_at INTEGER,

    PRIMARY KEY (kind, item_id)
) WITHOUT ROWID;
