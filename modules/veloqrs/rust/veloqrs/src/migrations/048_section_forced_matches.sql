-- The rides the athlete attached to a section by hand. A junction rebuild
-- deletes and rewrites every row a section holds, so the attachment is kept
-- here and not on a row, and each rebuild re-cuts these rides at the relaxed
-- bar the attach used.
--
-- No foreign key: detection deletes and re-inserts its rows on every apply,
-- and an attachment outlives that. Removing the ride or the section deletes
-- the record.
CREATE TABLE IF NOT EXISTS section_forced_matches (
    section_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    forced_at INTEGER NOT NULL,
    PRIMARY KEY (section_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_section_forced_matches_activity
    ON section_forced_matches(activity_id);
