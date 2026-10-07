-- Migration 051: owe the download of activities whose top heart rate zones
-- were never written.
--
-- Migration 045 added `hr_z6` and `hr_z7` with a default of 0, and the stored
-- zone series that could fill them was removed by migration 041, so a row
-- written before 045 reads zero there until its activity is downloaded again.
--
-- An activity with time in the first five zones and none in the last two is
-- marked not fetched, which makes the census owe its download. Activities
-- with no heart rate time have nothing to fill and are left alone. The
-- download writes both columns, and this runs once, so a five-zone athlete's
-- genuine zeros are not asked for again.

UPDATE activity_census
SET fetched_sync_date = NULL
WHERE fetched_sync_date IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM activity_metrics m
      LEFT JOIN activities a ON a.id = m.activity_id
      WHERE (m.activity_id = activity_census.intervals_id
             OR a.intervals_id = activity_census.intervals_id)
        AND COALESCE(m.hr_z6, 0) = 0
        AND COALESCE(m.hr_z7, 0) = 0
        AND COALESCE(m.hr_z1, 0) + COALESCE(m.hr_z2, 0) + COALESCE(m.hr_z3, 0)
            + COALESCE(m.hr_z4, 0) + COALESCE(m.hr_z5, 0) > 0
  );
