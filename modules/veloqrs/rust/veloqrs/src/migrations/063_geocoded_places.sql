-- The place name the geocoder answered for each cell of the map, in the
-- language it was asked in.
--
-- The provider's terms ask for every answer to be kept, and a place already
-- asked is never asked again. A cell is a latitude and a longitude rounded to
-- 1/200 of a degree, so about 550 m on a side, and both are stored as that
-- whole number of steps so two points in one cell can never round apart.
CREATE TABLE IF NOT EXISTS geocoded_places (
    lat_cell INTEGER NOT NULL,
    lng_cell INTEGER NOT NULL,

    -- The language tag the request carried, e.g. en-AU.
    language TEXT NOT NULL,

    -- NULL when the answer carried no place, which is kept too: asking again
    -- would get the same answer.
    name TEXT,

    -- When the answer arrived, in epoch milliseconds.
    answered_at INTEGER NOT NULL,

    PRIMARY KEY (lat_cell, lng_cell, language)
) WITHOUT ROWID;
