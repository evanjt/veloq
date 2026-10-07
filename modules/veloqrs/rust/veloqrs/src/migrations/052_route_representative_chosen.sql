-- Migration 052: record whether the athlete chose a route's representative.
--
-- A regroup carries a route's representative forward only when the athlete
-- chose it, and otherwise takes the grouping's own pick. Before this column
-- the grouping's pick was the member id that sorts first, so a stored
-- representative equal to that id is taken as the grouping's and any other as
-- a choice, which keeps every representative that could have been one.
-- A row whose member list does not read as JSON keeps its representative.

ALTER TABLE route_groups ADD COLUMN representative_chosen INTEGER NOT NULL DEFAULT 0;

UPDATE route_groups
SET representative_chosen = CASE
    WHEN json_valid(activity_ids)
         AND representative_id = (SELECT MIN(value) FROM json_each(route_groups.activity_ids))
    THEN 0
    ELSE 1
END;
