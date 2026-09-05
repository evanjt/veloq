-- Migration 022: how much of its section a traversal actually covers.
--
-- The personal-record rule tested the lap's own length against the section's,
-- and GPS wobble makes that 1.05 times the section at p50, so a lap joining a
-- third of the way along still cleared a 70 per cent bar. Coverage is the
-- fraction of the section the lap spans, projected onto the section line, and
-- it is what the record rule reads. NULL means not yet measured: the launch
-- backfill fills it, and every reader falls back to the old length test until
-- it does.

ALTER TABLE section_activities ADD COLUMN coverage REAL;

CREATE INDEX IF NOT EXISTS idx_section_activities_coverage
    ON section_activities(section_id, coverage);
