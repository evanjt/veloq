-- M25: Persistent storage for the incremental consensus accumulator.
--
-- tracematch's incremental section detection (Tier 2.1) keeps a per-section
-- running-sum state (`ConsensusAccumulator`) so adding new activities only
-- needs to walk the new traces' R-trees instead of every historical trace.
-- Without persistence the accumulator rebuilds from scratch on every engine
-- restart, defeating most of the win for the typical mobile usage pattern
-- (open app, sync a few activities, close). The accumulator is stored as a
-- MessagePack BLOB (rmp-serde) — same convention as gps_tracks.track_data
-- and signatures.points — to keep payload size and parse cost down vs JSON.
-- NULL = "build on next touch".

ALTER TABLE sections ADD COLUMN consensus_state_blob BLOB;
