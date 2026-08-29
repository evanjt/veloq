-- Migration 020: separate a settled FIT verdict from a failed download.
--
-- `fit_file_status` recorded one bit, `has_sets`, and every download failure
-- wrote `has_sets = 0`. A transport error or an expired token was therefore
-- indistinguishable from an activity whose FIT genuinely carries no sets, and
-- the row permanently excluded that activity from every retry path. `outcome`
-- names the verdict instead, and only a settled one is ever written.
ALTER TABLE fit_file_status ADD COLUMN outcome TEXT NOT NULL DEFAULT 'parsed';

UPDATE fit_file_status SET outcome = 'parsed' WHERE has_sets = 1;

-- Unpoison. Every `has_sets = 0` row predates the distinction, so it is either
-- a genuine no-sets FIT or a failure that stole the activity's data. Neither is
-- worth keeping over re-queuing: the first costs one download to confirm, the
-- second is the bug. Deleting re-queues both.
DELETE FROM fit_file_status WHERE has_sets = 0;
