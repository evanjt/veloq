-- What the athlete said about a ride on the review screen.
--
-- The notes and the effort slider were read by nothing, so both were lost on
-- every save. A ride can wait in the queue across launches, so they belong on
-- its row rather than in the screen that took them.
--
-- `rpe` is the effort from 1 to 10, NULL when the slider was never moved.
-- `rpe_sent` says intervals.icu has it: the effort goes up as an update after
-- the upload returns an id, and an update that failed is retried from here
-- without sending the file a second time.
ALTER TABLE recordings ADD COLUMN notes TEXT;
ALTER TABLE recordings ADD COLUMN rpe INTEGER;
ALTER TABLE recordings ADD COLUMN rpe_sent INTEGER NOT NULL DEFAULT 0;
