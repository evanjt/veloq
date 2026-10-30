-- The ranking no longer keeps whether a section's latest outing holds its record.
--
-- Nothing reads the flag: the ranked section no longer carries it, so the
-- column in `section_rank_inputs` goes. Every other field of a stored row is
-- untouched.
ALTER TABLE section_rank_inputs DROP COLUMN latest_is_pr;
