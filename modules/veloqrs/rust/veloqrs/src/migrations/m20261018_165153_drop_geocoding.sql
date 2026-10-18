-- Place names are no longer asked of a geocoder, so what the engine kept for
-- them goes: the answer per map cell, the name per route and section, and the
-- settings rows for the switch, its stamp, the served endpoint, the refusal
-- hold and the words a name was put together with.
--
-- A geocoded name was kept apart from the names the athlete typed, so nothing
-- they typed is lost: an item that showed one shows its number again.
DROP TABLE IF EXISTS geocoded_places;
DROP TABLE IF EXISTS geocoded_names;
DELETE FROM settings WHERE key IN (
    '__geocoding_enabled',
    '__geocoding_enabled_at',
    '__geocoder_config',
    '__geocoder_refused_until',
    '__place_name_words'
);
