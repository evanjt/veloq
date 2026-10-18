-- The title and body a native push run put in the tray, so the next run for
-- the same ride can tell whether it has anything new to say.
--
-- intervals.icu sends an uploaded and an analysed event for one ride about a
-- minute apart, and each reaches the handler as a run of its own. Without the
-- entry the first run posted, the second posted the same sentence again, which
-- sounded the phone twice and brought back an entry the athlete had dismissed.
--
-- Null on a run that posted nothing, and on every row from before the columns.
ALTER TABLE push_runs ADD COLUMN posted_title TEXT;
ALTER TABLE push_runs ADD COLUMN posted_body TEXT;
