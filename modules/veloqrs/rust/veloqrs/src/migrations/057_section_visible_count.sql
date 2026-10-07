-- The number of visible sections, kept as a stored count.
--
-- Counting the catalogue scanned every visible section on each read that
-- shows the total. `section_visible_count` holds that total in one row; the
-- triggers made by `ensure_section_visible_count` on every open keep it, and
-- that function also reseeds it, since a rebuild of `sections` drops the
-- triggers and copies rows without them.

CREATE TABLE section_visible_count (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    n INTEGER NOT NULL
);

INSERT INTO section_visible_count (id, n)
SELECT 1, COUNT(*) FROM sections WHERE disabled = 0 AND superseded_by IS NULL;
