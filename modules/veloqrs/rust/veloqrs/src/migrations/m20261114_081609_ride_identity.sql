-- What says two stored rows are one ride: the start on the athlete's wall
-- clock, as `activity_bodies.date` holds it, the sport the body names, and,
-- for a row made from a file, the recording device's serial number and the
-- time the file was created. A row made from intervals.icu's body has the
-- first two only.
--
-- The trigger below keeps the start and the sport in step with the body, so
-- every writer of a body is covered; the device columns are written by the
-- store of a file. A row is removed with its body.
CREATE TABLE IF NOT EXISTS ride_identity (
    activity_id TEXT PRIMARY KEY,
    device_serial INTEGER,
    created_unix INTEGER,
    start_local INTEGER NOT NULL,
    sport TEXT
);

CREATE INDEX IF NOT EXISTS idx_ride_identity_start ON ride_identity(start_local);
CREATE INDEX IF NOT EXISTS idx_ride_identity_device
    ON ride_identity(device_serial, created_unix) WHERE device_serial IS NOT NULL;

INSERT OR IGNORE INTO ride_identity (activity_id, start_local, sport)
SELECT activity_id, date, CASE WHEN json_valid(raw) THEN json_extract(raw, '$.type') END
FROM activity_bodies;

CREATE TRIGGER IF NOT EXISTS ride_identity_body_inserted AFTER INSERT ON activity_bodies
BEGIN
    INSERT INTO ride_identity (activity_id, start_local, sport)
    VALUES (NEW.activity_id, NEW.date,
            CASE WHEN json_valid(NEW.raw) THEN json_extract(NEW.raw, '$.type') END)
    ON CONFLICT(activity_id) DO UPDATE SET
        start_local = excluded.start_local, sport = excluded.sport;
END;

CREATE TRIGGER IF NOT EXISTS ride_identity_body_changed AFTER UPDATE OF date, raw ON activity_bodies
BEGIN
    INSERT INTO ride_identity (activity_id, start_local, sport)
    VALUES (NEW.activity_id, NEW.date,
            CASE WHEN json_valid(NEW.raw) THEN json_extract(NEW.raw, '$.type') END)
    ON CONFLICT(activity_id) DO UPDATE SET
        start_local = excluded.start_local, sport = excluded.sport;
END;

CREATE TRIGGER IF NOT EXISTS ride_identity_body_deleted AFTER DELETE ON activity_bodies
BEGIN
    DELETE FROM ride_identity WHERE activity_id = OLD.activity_id;
END;
