-- Migration 019: section enrichment and ranking columns.
--
-- Profile and shape of each section off its own slice (loss, steepest
-- sustained grade, straightness, class, lift flag) and the interestingness
-- score, pooled across the catalogue and within the section's sport. All
-- re-derivable: the next detection apply fills them.
ALTER TABLE sections ADD COLUMN elevation_loss_m REAL;
ALTER TABLE sections ADD COLUMN max_grade_percent REAL;
ALTER TABLE sections ADD COLUMN straightness REAL;
ALTER TABLE sections ADD COLUMN klass TEXT;
ALTER TABLE sections ADD COLUMN is_lift INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sections ADD COLUMN rank_score REAL;
ALTER TABLE sections ADD COLUMN sport_rank_score REAL;
CREATE INDEX IF NOT EXISTS idx_sections_rank_score ON sections(rank_score);
CREATE INDEX IF NOT EXISTS idx_sections_klass ON sections(klass);
