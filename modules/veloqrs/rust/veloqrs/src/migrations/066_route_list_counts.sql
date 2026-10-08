-- The routes screen's totals and counters, kept as stored counts.
--
-- The sections list counts its catalogue by kind (auto or custom, accepted or
-- not, removed or shown) and the routes list counts groups at or above a
-- member count. Both used to walk every row to count before they paged.
-- `section_list_counts` holds one row per kind of section and
-- `route_group_sizes` one row per member count, so a count reads a handful of
-- rows. The visible total is the shown kinds summed, so the single visible
-- count it replaces is dropped with the triggers an open made for it.
--
-- The triggers that keep both are made by `ensure_route_list_counts` on every
-- open, which also seeds the rows, since a rebuild of `sections` drops the
-- triggers and copies rows without them.

DROP TRIGGER IF EXISTS section_visible_count_ai;
DROP TRIGGER IF EXISTS section_visible_count_ad;
DROP TRIGGER IF EXISTS section_visible_count_au;
DROP TABLE section_visible_count;

CREATE TABLE section_list_counts (
    section_type TEXT NOT NULL,
    user_defined INTEGER NOT NULL,
    removed INTEGER NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (section_type, user_defined, removed)
) WITHOUT ROWID;

-- A group written before the member count was stored has none and is not
-- counted here; the list walks while any such group exists.
CREATE TABLE route_group_sizes (
    activity_count INTEGER NOT NULL PRIMARY KEY,
    n INTEGER NOT NULL
) WITHOUT ROWID;
