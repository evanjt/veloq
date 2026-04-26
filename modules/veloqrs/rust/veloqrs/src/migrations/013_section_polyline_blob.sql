-- Add binary blob columns for section polylines (postcard format).
-- Reads prefer blob, fall back to JSON for backward compatibility.
ALTER TABLE sections ADD COLUMN polyline_blob BLOB;
ALTER TABLE sections ADD COLUMN point_density_blob BLOB;
