-- Pairing secrets this phone has spent, each until its invitation expires.
--
-- A secret is spent on its first proof, good or bad, so a second scan of the
-- same QR code is refused. The rows are in the library rather than the process
-- so that a restart inside an invitation's lifetime cannot forget one. Each row
-- is keyed by the SHA-256 of its secret, so the library never holds a secret. A
-- row past its expiry is refused by the expiry check anyway, so the insert that
-- records a new secret also removes those. Empty on every library from before
-- the table.
CREATE TABLE remote_spent (
    digest BLOB PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
