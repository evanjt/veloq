DROP INDEX idx_ftp_history_date;
DROP TABLE ftp_history;
ALTER TABLE activity_metrics DROP COLUMN power_zone_times;
ALTER TABLE activity_metrics DROP COLUMN hr_zone_times;
