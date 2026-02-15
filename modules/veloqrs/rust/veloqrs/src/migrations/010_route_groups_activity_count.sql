-- Cache activity_count column on route_groups to avoid JSON parsing of activity_ids
-- just to get the count. Populated at INSERT time and backfilled via migration.
ALTER TABLE route_groups ADD COLUMN activity_count INTEGER;
