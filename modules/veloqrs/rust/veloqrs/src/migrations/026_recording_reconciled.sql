-- The reconcile flag the index carried and the table did not.
--
-- A ride uploaded while the engine was closed lands its intervals.icu id
-- nowhere, and the sweep that replays those writes needs to know which rows
-- still owe one. Without this it either replays every uploaded ride on every
-- launch or replays none.
ALTER TABLE recordings ADD COLUMN engine_reconciled INTEGER NOT NULL DEFAULT 0;
