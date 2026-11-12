-- Which side worked a row's load, intensity and zone times out: 'veloq' for a
-- row Veloq scored from its stored streams, 'intervals' for a row that carries
-- the figures intervals.icu served, NULL for a row with neither.
--
-- Empty on every library from before the column; the stored streams of a row
-- with no figures are scored by the backfill the engine starts at open.
ALTER TABLE activity_metrics ADD COLUMN metrics_source TEXT;
