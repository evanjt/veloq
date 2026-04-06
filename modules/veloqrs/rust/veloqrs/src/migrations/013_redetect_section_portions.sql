-- Migration 013: Force section re-detection with improved lap splitting
--
-- The portions algorithm now splits contiguous out-and-back and loop
-- traversals into individual laps. Clearing processed_activities forces
-- full re-detection on the next sync so all sections get recomputed
-- with the new algorithm.

DELETE FROM processed_activities;
