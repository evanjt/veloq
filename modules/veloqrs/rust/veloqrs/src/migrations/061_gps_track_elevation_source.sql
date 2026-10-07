-- Which altitude series a stored track's points carry: 0 unknown, 1 the
-- corrected series upstream derives, 2 the series the device recorded, 3
-- altitude recorded on the phone by this app.
--
-- The two upstream series can disagree by more than double over a short
-- window, so a ranking of climbing bests keeps to the corrected one and has to
-- tell the two apart. `elevation_state` says only whether elevation was
-- fetched.
--
-- Every existing row starts unknown. Nothing stored before this records which
-- series it chose, and the elevation backfill asks upstream once for each
-- fetched track to settle it.

ALTER TABLE gps_tracks ADD COLUMN elevation_source INTEGER NOT NULL DEFAULT 0;
