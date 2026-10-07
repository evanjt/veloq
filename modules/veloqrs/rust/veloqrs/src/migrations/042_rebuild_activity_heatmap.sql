-- Rebuild the training calendar from activity_metrics. Installs that last
-- opened at 40 or 41 hold synced activities that never reached
-- activity_heatmap, and days whose activities have gone.
DELETE FROM activity_heatmap;
INSERT INTO activity_heatmap (date, intensity, max_duration, activity_count)
SELECT date(date, 'unixepoch'),
       CASE
           WHEN MAX(moving_time) > 7200 THEN 4
           WHEN MAX(moving_time) > 5400 THEN 3
           WHEN MAX(moving_time) > 3600 THEN 2
           WHEN MAX(moving_time) > 0 THEN 1
           ELSE 0
       END,
       MAX(moving_time),
       COUNT(*)
FROM activity_metrics
GROUP BY date(date, 'unixepoch');
