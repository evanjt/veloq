#!/usr/bin/env python3
"""Time what a relaunch pays for the log a killed process left behind.

A process that is swiped away leaves `-wal` and `-shm` on disk. The next open
either finds the shared-memory index intact, which is the swipe-away case, or
has to rebuild it by reading the whole log, which is the case after the index
is lost. Then the first commit of the new process checkpoints the backlog.

The fixture grows the log by pinning a read snapshot while a writer commits
page updates, then kills the writer with SIGKILL, evicts the files from the
page cache, and times, in order: a read-write open with the pragmas the engine
sets, a first read on it, a read-only open and read on a second connection,
and the first small commit, which carries the automatic checkpoint.

Usage: measure-wal-recovery.py [DIR] [WAL_MB ...]
"""

import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time

PAGE = 4096
ROW_BYTES = 100 * 1024
ROWS = 2000  # about 200 MB of main file
BUSY_MS = 5000


def evict(path):
    for suffix in ("", "-wal", "-shm"):
        p = path + suffix
        if not os.path.exists(p):
            continue
        fd = os.open(p, os.O_RDONLY)
        try:
            os.fsync(fd)
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        finally:
            os.close(fd)


def size_mb(path):
    return os.path.getsize(path) / (1024 * 1024) if os.path.exists(path) else 0.0


def build_library(path):
    if os.path.exists(path):
        return
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute(f"PRAGMA page_size = {PAGE}")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("CREATE TABLE streams (id INTEGER PRIMARY KEY, body BLOB)")
    conn.execute("BEGIN")
    for i in range(ROWS):
        conn.execute("INSERT INTO streams VALUES (?, ?)", (i, os.urandom(ROW_BYTES)))
    conn.execute("COMMIT")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()


def grow_log(path, target_mb):
    """Child: pin a snapshot, write until the log reaches the target, then keep writing."""
    pin = sqlite3.connect(path, isolation_level=None)
    pin.execute("BEGIN")
    pin.execute("SELECT id FROM streams LIMIT 1").fetchall()
    writer = sqlite3.connect(path, isolation_level=None)
    writer.execute("PRAGMA journal_mode = WAL")
    writer.execute("PRAGMA synchronous = NORMAL")
    writer.execute("PRAGMA journal_size_limit = 4194304")
    i = 0
    announced = False
    while True:
        writer.execute("BEGIN")
        for _ in range(10):
            writer.execute(
                "UPDATE streams SET body = ? WHERE id = ?",
                (os.urandom(ROW_BYTES), i % ROWS),
            )
            i += 1
        writer.execute("COMMIT")
        if not announced and size_mb(path + "-wal") >= target_mb:
            print("ready", flush=True)
            announced = True


def timed(label, fn):
    t = time.perf_counter()
    out = fn()
    ms = (time.perf_counter() - t) * 1000
    print(f"    {label:<44} {ms:9.1f} ms")
    return out


def relaunch(path):
    """What the engine does at open, then the pool's reader, then the first commit."""

    def open_engine():
        c = sqlite3.connect(path, isolation_level=None, timeout=BUSY_MS / 1000)
        c.execute("PRAGMA journal_mode = WAL").fetchall()
        c.execute("PRAGMA synchronous = NORMAL")
        c.execute("PRAGMA journal_size_limit = 4194304").fetchall()
        return c

    engine = timed("engine open, journal_mode pragma", open_engine)
    timed(
        "engine first read (one row)",
        lambda: engine.execute("SELECT length(body) FROM streams WHERE id = 7").fetchall(),
    )

    def open_reader():
        c = sqlite3.connect(
            f"file:{path}?mode=ro", uri=True, isolation_level=None, timeout=BUSY_MS / 1000
        )
        c.execute("BEGIN DEFERRED")
        rows = c.execute("SELECT count(*) FROM streams").fetchall()
        c.execute("ROLLBACK")
        return c, rows

    timed("pool reader open, snapshot, count(*)", open_reader)
    timed(
        "engine first commit (auto checkpoint)",
        lambda: engine.execute("UPDATE streams SET body = x'00' WHERE id = 1"),
    )
    busy = timed(
        "explicit wal_checkpoint(PASSIVE)",
        lambda: engine.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchall(),
    )
    print(f"    checkpoint result (busy, log, checkpointed) {busy[0]}")
    engine.close()


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--grow":
        grow_log(sys.argv[2], float(sys.argv[3]))
        return
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/wal-recovery-measure")
    targets = [float(a) for a in sys.argv[2:]] or [8, 64, 256, 1024]
    os.makedirs(base, exist_ok=True)
    pristine = os.path.join(base, "library.db")
    build_library(pristine)
    print(f"library {size_mb(pristine):.0f} MB, sqlite {sqlite3.sqlite_version}, dir {base}")

    for target in targets:
        for keep_shm in (True, False):
            path = os.path.join(base, "run.db")
            for suffix in ("", "-wal", "-shm"):
                if os.path.exists(path + suffix):
                    os.remove(path + suffix)
            shutil.copyfile(pristine, path)
            child = subprocess.Popen(
                [sys.executable, __file__, "--grow", path, str(target)],
                stdout=subprocess.PIPE,
                text=True,
            )
            child.stdout.readline()
            time.sleep(0.2)
            os.kill(child.pid, signal.SIGKILL)
            child.wait()
            if not keep_shm:
                os.remove(path + "-shm")
            evict(path)
            shm = "shm intact (swipe-away)" if keep_shm else "shm removed (index lost)"
            print(
                f"\n  log {size_mb(path + '-wal'):.0f} MB, main {size_mb(path):.0f} MB, {shm}"
            )
            relaunch(path)
            print(f"    log after checkpoint {size_mb(path + '-wal'):.0f} MB")


if __name__ == "__main__":
    main()
