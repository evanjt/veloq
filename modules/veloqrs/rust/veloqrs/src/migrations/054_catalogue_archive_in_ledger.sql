-- Migration 054: the cutover archive moves into the section ledger.
--
-- Each section a cutover replaced is an `archived` row in `section_history`
-- naming a milestone version in `section_geometry`, which holds the ride and
-- range its line was sliced from, and the line itself only while that range
-- cannot rebuild it. The two archive tables are read by nothing after that.
--
-- Their rows are carried into the ledger by the open before this runs, since
-- matching a stored line to the range that re-slices it is not SQL's to do.

DROP TABLE IF EXISTS section_catalogue_archive_members;
DROP TABLE IF EXISTS section_catalogue_archive;

-- A stored ride settles the versions that named it while it was absent, so
-- every stored track looks them up by ride.
CREATE INDEX IF NOT EXISTS idx_section_geometry_orphaned
    ON section_geometry(rep_activity_id) WHERE source = 'orphaned';
