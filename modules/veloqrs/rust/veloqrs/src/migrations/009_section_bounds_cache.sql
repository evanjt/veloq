-- Cache bounding box columns on sections table to avoid JSON polyline deserialization
-- in get_section_summaries(). Populated at INSERT time and backfilled via migration.
ALTER TABLE sections ADD COLUMN bounds_min_lat REAL;
ALTER TABLE sections ADD COLUMN bounds_max_lat REAL;
ALTER TABLE sections ADD COLUMN bounds_min_lng REAL;
ALTER TABLE sections ADD COLUMN bounds_max_lng REAL;
