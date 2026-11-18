-- The secret a linked browser and this phone share from pairing, which keys
-- the room they reconnect in so a room id cannot be computed from the two
-- certificate fingerprints that every offer and answer carries.
--
-- Null on every browser linked before this column. Those keep the older
-- fingerprint-only room until they are linked again.
ALTER TABLE linked_devices ADD COLUMN room_secret BLOB;
