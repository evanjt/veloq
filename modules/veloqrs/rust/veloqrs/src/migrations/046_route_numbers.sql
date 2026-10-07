-- The number an unnamed route is shown under, apart from any name the athlete
-- typed. The label is the current language's route word and this number, put
-- together when it is read, so it follows a change of language, and UNIQUE
-- keeps two routes off one number whichever writer mints it.
--
-- Rows are minted when the engine next loads its groups. A name a released
-- build stored in route_names stays the route's name.
CREATE TABLE IF NOT EXISTS route_numbers (
    route_id TEXT PRIMARY KEY NOT NULL,
    number INTEGER NOT NULL UNIQUE CHECK (number > 0)
);

-- Maintained on every group write and read by no query.
DROP INDEX IF EXISTS idx_groups_sport;
