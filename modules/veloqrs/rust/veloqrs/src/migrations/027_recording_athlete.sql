-- Whose recording this is.
--
-- A forced sign-out holds pending recordings rather than demoting them, so the
-- upload path has to be able to say who recorded a FIT before it sends it
-- anywhere. The row carried no athlete at all, and the only defence against a
-- ride landing in the next account was demoting the whole queue.
--
-- Nullable, and NULL is not "anyone's": it is a row saved before this column
-- existed. A requeue treats an unmatched athlete and an absent one the same
-- way, by leaving the entry held for the athlete to send up by hand.
ALTER TABLE recordings ADD COLUMN athlete_id TEXT;

-- The requeue asks for one athlete's held entries, never for the whole table.
CREATE INDEX IF NOT EXISTS idx_recordings_athlete_id ON recordings(athlete_id);
