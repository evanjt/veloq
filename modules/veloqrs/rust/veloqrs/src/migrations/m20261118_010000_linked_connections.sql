-- Each linked browser's connection history: when it came up and went down, the
-- address the phone saw it at, whether that address is on the phone's own
-- network, and what the client said it is. The description is the client's
-- own claim and is never verified.
--
-- One row per connection, the last 50 kept for each browser. A row goes with
-- the browser that made it. Empty on every library from before the table.
CREATE TABLE linked_connections (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES linked_devices(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    end_reason TEXT,
    remote_address TEXT NOT NULL,
    this_network INTEGER NOT NULL,
    client_kind TEXT,
    client_browser TEXT,
    client_os TEXT,
    client_tool TEXT,
    client_tool_version TEXT
);

CREATE INDEX idx_linked_connections_device ON linked_connections(device_id, id);

-- Offers from a certificate that is not linked, counted for the day they
-- arrived (Unix seconds of the day's start, UTC). Nothing about the sender is
-- kept.
CREATE TABLE linked_refusals (
    day INTEGER PRIMARY KEY,
    refused INTEGER NOT NULL
);
