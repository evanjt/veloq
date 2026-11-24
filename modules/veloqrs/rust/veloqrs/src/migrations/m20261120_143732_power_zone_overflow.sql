-- Owe the download of activities whose power zone columns hold time above the
-- athlete's last power zone.
--
-- Releases before the by-id zone read stored the zone time list positionally
-- into `power_z1` to `power_z7`, and that list ends with an extra entry. For an
-- athlete whose sport entry lists fewer than seven power zones, the extra entry
-- sits in a column no zone of theirs maps to, and the zone chart draws it as a
-- zone.
--
-- A fetched activity with time in `power_z6` or `power_z7` beyond the zone
-- count of the entry that covers its sport is marked not fetched, so the census
-- owes its download, which writes the zones by id. The entry is the first one
-- listing the sport, else the one for unlisted sports. A sport with no entry,
-- or an entry with no zones, is left alone. This runs once.
UPDATE activity_census
SET fetched_sync_date = NULL
WHERE fetched_sync_date IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM activity_metrics m
      LEFT JOIN activities a ON a.id = m.activity_id
      JOIN sport_settings s ON s.id = 'current' AND json_valid(s.data)
      JOIN json_each(s.data) e ON json_type(e.value) = 'object'
      WHERE (m.activity_id = activity_census.intervals_id
             OR a.intervals_id = activity_census.intervals_id)
        AND json_type(e.value, '$.power_zones') = 'array'
        AND json_array_length(e.value, '$.power_zones') > 0
        AND e.key = COALESCE(
            (SELECT MIN(f.key)
             FROM json_each(s.data) f
             WHERE json_type(f.value, '$.types') = 'array'
               AND EXISTS (SELECT 1 FROM json_each(f.value, '$.types') t
                           WHERE t.value = m.sport_type)),
            (SELECT MIN(f.key)
             FROM json_each(s.data) f
             WHERE json_extract(f.value, '$.other') IN (1, 'true')))
        AND (   (COALESCE(m.power_z7, 0) > 0
                 AND json_array_length(e.value, '$.power_zones') < 7)
             OR (COALESCE(m.power_z6, 0) > 0
                 AND json_array_length(e.value, '$.power_zones') < 6))
  );
