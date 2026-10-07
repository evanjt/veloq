#!/usr/bin/env python3
"""Read a first-load capture back: one line per snapshot, per traversal of one activity.

Usage: python3 -I scripts/first-load-records.py <capture dir> <activity id>

For each snapshot `scripts/capture-first-load.sh` wrote, it prints the library's progress and, for
every section the activity crosses, the traversal's lap time, its best rival and whether the
activity holds the record, by the rule the activity encounters read applies: a complete traversal,
rivals in the same sport and direction, a first outing beating nothing. A record flag that flips
between two snapshots is printed with the reason the rival set changed, so a record judged against
a partial history reads differently from a section whose identity or geometry moved.
"""

import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile

MIN_SECTION_COVERAGE = 0.9
MIN_LENGTH_RATIO = 0.7
PR_TOLERANCE_SECS = 0.01

COMPLETE = f"""sa.direction != 'partial' AND (CASE
  WHEN sa.coverage IS NOT NULL THEN sa.coverage >= {MIN_SECTION_COVERAGE}
  WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1
  ELSE sa.distance_meters >= s.distance_meters * {MIN_LENGTH_RATIO} END)"""


def open_snapshot(path):
    """A private copy, since opening a WAL file writes its shared-memory sidecar."""
    work = tempfile.mkdtemp()
    for name in ("routes.db", "routes.db-wal", "routes.db-shm"):
        source = os.path.join(path, name)
        if os.path.exists(source):
            shutil.copy(source, os.path.join(work, name))
    if not os.path.exists(os.path.join(work, "routes.db")):
        shutil.rmtree(work)
        return None, None
    return sqlite3.connect(os.path.join(work, "routes.db")), work


def scalar(conn, sql, *args):
    row = conn.execute(sql, args).fetchone()
    return row[0] if row else None


def geometry_hash(conn, section_id):
    row = conn.execute(
        "SELECT polyline_blob, polyline_json FROM sections WHERE id = ?", (section_id,)
    ).fetchone()
    if not row:
        return None
    blob = row[0] if row[0] is not None else (row[1] or "").encode()
    return hashlib.sha1(blob).hexdigest()[:10]


def traversals(conn, activity_id):
    rows = conn.execute(
        f"""SELECT sa.section_id, sa.direction, COALESCE(sa.lap_time, 0), ({COMPLETE}) AS complete,
                   COALESCE(s.name, ''), s.disabled, s.superseded_by, sa.excluded
            FROM section_activities sa JOIN sections s ON s.id = sa.section_id
            WHERE sa.activity_id = ?
            ORDER BY sa.section_id, sa.direction, complete DESC,
                     CASE WHEN sa.lap_time IS NULL OR sa.lap_time <= 0 THEN 1 ELSE 0 END,
                     sa.lap_time ASC""",
        (activity_id,),
    ).fetchall()
    seen = set()
    out = []
    for section_id, direction, lap, complete, name, disabled, superseded, excluded in rows:
        if (section_id, direction) in seen:
            continue
        seen.add((section_id, direction))
        others = conn.execute(
            f"""SELECT sa.lap_time, sa.activity_id FROM section_activities sa
                JOIN activities a ON a.id = sa.activity_id
                LEFT JOIN sections s ON s.id = sa.section_id
                WHERE sa.section_id = ? AND sa.direction = ?
                  AND a.sport_type = (SELECT sport_type FROM activities WHERE id = ?)
                  AND sa.excluded = 0 AND sa.lap_time IS NOT NULL AND sa.lap_time > 0
                  AND {COMPLETE}""",
            (section_id, direction, activity_id),
        ).fetchall()
        rivals = [t for t, a in others if a != activity_id]
        rival = min(rivals) if rivals else None
        pending = scalar(
            conn,
            """SELECT COUNT(*) FROM section_activities sa JOIN activities a ON a.id = sa.activity_id
               WHERE sa.section_id = ? AND sa.direction = ? AND sa.activity_id != ?
                 AND a.sport_type = (SELECT sport_type FROM activities WHERE id = ?)
                 AND (sa.lap_time IS NULL OR sa.lap_time <= 0)""",
            section_id, direction, activity_id, activity_id,
        )
        visible = not disabled and superseded is None and not excluded
        is_pr = (
            visible and bool(complete) and rival is not None and lap > 0
            and rival - lap >= PR_TOLERANCE_SECS
        )
        out.append({
            "section": section_id,
            "name": name,
            "direction": direction,
            "visible": visible,
            "superseded_by": superseded,
            "complete": bool(complete),
            "lap": round(lap, 1),
            "rival": None if rival is None else round(rival, 1),
            "rivals": len(rivals),
            "rivals_without_time": pending,
            "pr": is_pr,
            "geometry": geometry_hash(conn, section_id),
        })
    return out


def screen_records(path):
    """The texts on screen that read as a record, when a hierarchy was taken."""
    ui = os.path.join(path, "ui.xml")
    if not os.path.exists(ui):
        return None
    with open(ui, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    marks = []
    for chunk in text.split("<node ")[1:]:
        for key in ('text="', 'content-desc="'):
            if key in chunk:
                value = chunk.split(key, 1)[1].split('"', 1)[0]
                if value and ("PR" in value.split() or "record" in value.lower()):
                    marks.append(value)
    return marks


def main():
    root, activity_id = sys.argv[1], sys.argv[2]
    previous = {}
    for snapshot in sorted(os.listdir(root)):
        path = os.path.join(root, snapshot)
        if not os.path.isdir(path):
            continue
        with open(os.path.join(path, "time")) as handle:
            stamp = handle.read().strip()
        conn, work = open_snapshot(path)
        if conn is None:
            print(json.dumps({"snapshot": snapshot, "time": stamp, "db": None}))
            continue
        try:
            library = {
                "activities": scalar(conn, "SELECT COUNT(*) FROM activities"),
                "sections": scalar(
                    conn,
                    "SELECT COUNT(*) FROM sections WHERE disabled = 0 AND superseded_by IS NULL",
                ),
                "portions": scalar(conn, "SELECT COUNT(*) FROM section_activities"),
                "portions_without_time": scalar(
                    conn,
                    "SELECT COUNT(*) FROM section_activities WHERE lap_time IS NULL OR lap_time <= 0",
                ),
            }
            rows = traversals(conn, activity_id)
            indicators = conn.execute(
                "SELECT indicator_type, target_id, direction, lap_time FROM activity_indicators "
                "WHERE activity_id = ?",
                (activity_id,),
            ).fetchall()
        except sqlite3.DatabaseError as error:
            print(json.dumps({"snapshot": snapshot, "time": stamp, "db": str(error)}))
            continue
        finally:
            conn.close()
            shutil.rmtree(work)

        current = {(r["section"], r["direction"]): r for r in rows}
        changes = []
        for key in sorted(set(previous) | set(current)):
            before, after = previous.get(key), current.get(key)
            if before is None or after is None:
                changes.append({"pair": key, "appeared" if before is None else "gone": True})
            elif before["pr"] != after["pr"] or before["geometry"] != after["geometry"]:
                changes.append({"pair": key, "before": before, "after": after})
        print(json.dumps({
            "snapshot": snapshot,
            "time": stamp,
            "library": library,
            "records": sorted(f"{r['section']}/{r['direction']}" for r in rows if r["pr"]),
            "indicators": [list(i) for i in indicators],
            "screen": screen_records(path),
            "changes": changes,
            "traversals": rows,
        }))
        previous = current


if __name__ == "__main__":
    main()
