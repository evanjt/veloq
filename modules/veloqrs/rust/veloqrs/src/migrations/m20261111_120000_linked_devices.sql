-- Browsers the athlete linked to this phone, and the phone's own identity.
--
-- A linked browser is pinned by the fingerprint of its certificate. A peer
-- whose fingerprint has no row here is refused, so removing a row is what
-- unlinks a device. The identity row holds the phone's own certificate, made
-- once, so a browser that pinned it can recognise the phone again.
--
-- Both are empty on every library from before the tables.
CREATE TABLE linked_devices (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER
);

CREATE TABLE remote_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    certificate BLOB NOT NULL
);
