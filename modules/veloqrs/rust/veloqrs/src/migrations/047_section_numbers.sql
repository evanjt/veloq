-- The number each section is shown under when it has no name of its own. The
-- label is the current language's section word and this number, put together
-- when it is read, so it follows a change of language, and UNIQUE keeps two
-- sections off one number whichever writer inserts them.
--
-- No foreign key: detection deletes and re-inserts its rows on every apply, and
-- a section keeps its number across that. The trigger that numbers each new
-- row is created by the engine after the migrations, because rebuilding the
-- sections table drops every trigger on it.
CREATE TABLE IF NOT EXISTS section_numbers (
    section_id TEXT PRIMARY KEY NOT NULL,
    number INTEGER NOT NULL UNIQUE CHECK (number > 0)
);
