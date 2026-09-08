-- One answer to "have I already asked for this".
--
-- Three lived in the tree: `spawn_once`'s process-local `HashSet`, which a
-- restart empties silently; the exclusive sync slot, a bare boolean that cannot
-- say what is running; and a TypeScript `Set` of accepted windows, in which a
-- refused window and one never asked for look the same.
--
-- What this holds is attempt bookkeeping and never a work row. Every pending
-- set in the engine is derived by negation from a completion marker, and
-- migration 020's own comment records what a stored failure row cost the last
-- time one existed. So there is no status column: whether the work is still
-- owed is the caller's own question, answered against its own marker.
CREATE TABLE IF NOT EXISTS job_attempts (
    -- `kind` plus its ordered discriminants, joined by colons, which is the
    -- vocabulary `spawn_once` already writes at seven call sites. A key over an
    -- unbounded list is the count and a hash of it, never the list.
    key TEXT PRIMARY KEY,

    -- Failures behind this key. Zero for a key that has only ever been claimed,
    -- so a lease a restart frees is not also in a backoff.
    attempts INTEGER NOT NULL DEFAULT 0,

    -- When the last attempt started or ended, in epoch milliseconds. The
    -- backoff is measured from it.
    last_attempt_at INTEGER,

    -- What the last failure said, for a caller that has to show it.
    last_error TEXT,

    -- Why the last attempt was refused, named from the `FfiStartOutcome`
    -- taxonomy so nothing re-derives it from an error string.
    last_refusal TEXT,

    -- The lease, and it is a generation rather than a deadline. The engine
    -- mints one at init, and a row is held only while this equals the current
    -- generation, so every row a dead process left behind is free the moment
    -- the next launch mints, whether that process exited cleanly, was killed or
    -- panicked. A deadline alone would strand a row for its whole duration
    -- after a crash, which is the failure sections/conditioning.rs argues
    -- against in writing.
    --
    -- The within-run stall is a second mechanism and not this one. It is not
    -- built here: nothing yet holds a lease long enough for it to matter, and a
    -- deadline nobody needs is a column that lies.
    lease_gen INTEGER NOT NULL DEFAULT 0
);

-- The one query that is not by key: freeing what a generation left behind.
CREATE INDEX IF NOT EXISTS idx_job_attempts_lease_gen ON job_attempts(lease_gen);
