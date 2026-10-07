-- The route lines the map draws, built once per group write.
--
-- Drawing the routes read every route group and decoded each representative's
-- track inside the map read. `route_line_layer` holds those lines already
-- encoded, in one row stamped with the route group generation it was built
-- from. A read whose generation no longer matches the stamp gets no lines, and
-- the engine rebuilds the row on its next open or group write.
--
-- Empty on upgrade: the first foreground load builds it from the stored groups.

CREATE TABLE route_line_layer (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL,
    route_count INTEGER NOT NULL,
    layer BLOB NOT NULL
);
