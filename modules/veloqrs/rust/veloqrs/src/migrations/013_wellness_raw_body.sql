-- Keep the untyped wellness body alongside the typed columns.
--
-- The typed columns are the fields Rust computes on. The UI also reads fields
-- nothing in Rust needs (hrr, hrvSDNN, vo2max, readiness), so once the wellness
-- read moves off the API a typed-only row would silently drop them.

ALTER TABLE wellness ADD COLUMN raw TEXT;
