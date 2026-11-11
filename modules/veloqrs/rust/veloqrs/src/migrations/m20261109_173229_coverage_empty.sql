-- A portion whose coverage cannot be taken.
--
-- `coverage` stays NULL for a traversal of a single fix or one that lies
-- outside its track, and a NULL beside a stored track was read as "not yet
-- measured", so the track was decoded again on every load. `coverage_empty`
-- records that the portion was read and no coverage could be taken from it.
-- Rewriting the portion's indices or storing a new track clears it.
--
-- Nothing backfills it. Every row is 0 after the upgrade, which reads as not
-- yet looked at.

ALTER TABLE section_activities ADD COLUMN coverage_empty INTEGER NOT NULL DEFAULT 0;
