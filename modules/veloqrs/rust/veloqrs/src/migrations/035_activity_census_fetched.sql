-- Migration 035: which census rows the device has actually fetched.
--
-- Migration 034 recorded what intervals.icu says the account holds. That alone
-- cannot answer "do I still owe this download": an activity can be present
-- locally and stale, because the census carries the moment it last changed
-- upstream and the activities table carries no such mark.
--
-- This column is that mark. A window sync writes the census row's own
-- `icu_sync_date` into it for every id it stored, so a later census that moves
-- `icu_sync_date` on leaves the two unequal and the window owes the download
-- again. NULL is the honest starting value: never fetched.
--
-- Nothing backfills it. Every row is NULL after the upgrade, so the first
-- window sync after it runs as it always did and marks what it stored.

ALTER TABLE activity_census ADD COLUMN fetched_sync_date TEXT;
