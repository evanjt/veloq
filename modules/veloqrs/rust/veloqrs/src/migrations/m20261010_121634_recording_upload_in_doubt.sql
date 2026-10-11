-- Whether an upload attempt went out and ended without saying whether the
-- server created the activity: a timeout or a dropped connection after the
-- request was sent, a 5xx, or an app killed mid-request. Such a ride is looked
-- for on intervals.icu before it is sent again, so a create that landed is not
-- posted a second time.
--
-- A ride already part way through the queue may have had such an attempt
-- before the column existed, so each one is looked for once.
ALTER TABLE recordings ADD COLUMN upload_in_doubt INTEGER NOT NULL DEFAULT 0;
UPDATE recordings SET upload_in_doubt = 1
WHERE upload_status = 'uploading'
   OR (upload_status IN ('pending', 'failed') AND last_attempt_at IS NOT NULL);
