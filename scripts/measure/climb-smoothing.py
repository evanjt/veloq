#!/usr/bin/env python3
"""
Measure how a centred mean over corrected elevation moves climbing bests
across a whole library, per window and per period.

Fetches time, latlng and fixed_altitude for every activity in the Ride and
Run climbing families from intervals.icu with the key in the root .env, keeps
the streams in the scratchpad only, and reproduces the engine's window rule:
net endpoint gain over the shortest run of samples spanning the window, with
a step over 10 s or a missing elevation ruling a window out. Each window's
best is computed unsmoothed, then with a centred 5- and 9-sample mean that
never crosses a step the engine would refuse.

Usage: python3 -I scripts/measure/climb-smoothing.py [--cache DIR]
"""

import argparse
import base64
import json
import math
import sys
import time as clock
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[2].parent
ENV = ROOT / ".env"
BASE = "https://intervals.icu/api/v1"
WINDOWS = [15, 30, 60, 300, 600, 1200]
MAX_STEP_S = 10
PERIOD_DAYS = {"30 d": 30, "90 d": 90, "6 m": 180, "1 y": 365, "all": 0}

CYCLING = ["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide",
           "EMountainBikeRide", "TrackRide", "Cyclocross", "Handcycle", "Velomobile"]
RUNNING = ["Run", "VirtualRun", "TrailRun", "Treadmill"]
EXCLUDED = {"EBikeRide", "EMountainBikeRide", "VirtualRide", "VirtualRun", "Treadmill"}
FAMILIES = {
    "Ride": [s for s in CYCLING if s not in EXCLUDED],
    "Run": [s for s in RUNNING if s not in EXCLUDED],
}


def env_value(key):
    for line in ENV.read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit(f"missing {key} in {ENV}")


def session():
    creds = base64.b64encode(f"API_KEY:{env_value('EXPO_PUBLIC_API_KEY')}".encode()).decode()
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Basic {creds}",
        "Accept": "application/json",
        "User-Agent": "veloq-measure/1.0",
    })
    return s


def fetch_json(s, url, params=None):
    for attempt in range(5):
        r = s.get(url, params=params, timeout=60)
        if r.status_code == 429:
            clock.sleep(5 * (attempt + 1))
            continue
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def streams_for(s, cache, aid):
    path = cache / f"{aid}.json"
    if path.exists():
        return json.loads(path.read_text())
    body = fetch_json(s, f"{BASE}/activity/{aid}/streams",
                      {"types": "time,latlng,fixed_altitude"})
    path.write_text(json.dumps(body if body is not None else []))
    clock.sleep(0.2)
    return body


def is_storable(lat, lng):
    return (isinstance(lat, (int, float)) and isinstance(lng, (int, float))
            and math.isfinite(lat) and math.isfinite(lng)
            and -90 <= lat <= 90 and -180 <= lng <= 180 and not (lat == 0 and lng == 0))


def parse(body):
    """(time, elevation) as the engine would store them, or None when the
    corrected series is unusable or the track has no positions."""
    by = {s.get("type"): s for s in body or []}
    latlng, tm, fixed = by.get("latlng"), by.get("time"), by.get("fixed_altitude")
    if not latlng or not tm or not fixed:
        return None
    lats, lngs = latlng.get("data") or [], latlng.get("data2") or []
    n = min(len(lats), len(lngs))
    mask = [i for i in range(n) if is_storable(lats[i], lngs[i])]
    if len(mask) < 2:
        return None
    tdata, edata = tm["data"], fixed["data"]
    if len(tdata) < n or len(edata) < n:
        return None
    t = np.array([int(tdata[i]) if isinstance(tdata[i], (int, float)) else 0 for i in mask],
                 dtype=np.int64)
    e = np.array([float(edata[i]) if isinstance(edata[i], (int, float)) else np.nan for i in mask],
                 dtype=np.float64)
    if not np.isfinite(e).any():
        return None
    return t, e


def good_steps(t):
    """good[k] for k>=1: the step into sample k is increasing and within MAX_STEP_S."""
    g = np.zeros(len(t), dtype=bool)
    d = np.diff(t)
    g[1:] = (d > 0) & (d <= MAX_STEP_S)
    return g


def smooth(e, g, k):
    """Centred k-sample mean within runs the engine would not refuse: the
    mean of finite neighbours in the same run, NaN where the sample was."""
    if k <= 1:
        return e.copy()
    h = k // 2
    out = np.full_like(e, np.nan)
    runs = np.flatnonzero(~g)
    bounds = list(runs) + [len(e)]
    for a, b in zip(bounds[:-1], bounds[1:]):
        seg = e[a:b]
        finite = np.isfinite(seg)
        vals = np.where(finite, seg, 0.0)
        cs = np.concatenate([[0.0], np.cumsum(vals)])
        cc = np.concatenate([[0], np.cumsum(finite)])
        idx = np.arange(len(seg))
        lo = np.maximum(idx - h, 0)
        hi = np.minimum(idx + h + 1, len(seg))
        cnt = cc[hi] - cc[lo]
        mean = np.divide(cs[hi] - cs[lo], cnt, out=np.full(len(seg), np.nan), where=cnt > 0)
        out[a:b] = np.where(finite, mean, np.nan)
    return out


def best_windows(t, e, g):
    """The engine's rule, vectorised: for each start i the shortest j with
    t[j]-t[i] >= w, refused when any sample in [i, j] is missing or any step
    in (i, j] is bad. Returns {w: (vam, start, end)} for windows with a value."""
    n = len(t)
    bad_pt = np.concatenate([[0], np.cumsum(~np.isfinite(e))])
    bad_st = np.concatenate([[0], np.cumsum(~g[1:])])  # bad_st[k] = bad steps among 1..=k
    out = {}
    for w in WINDOWS:
        j = np.searchsorted(t, t + w, side="left")
        i = np.arange(n)
        ok = j < n
        i, j = i[ok], j[ok]
        ok = (t[j] > t[i]) & (bad_pt[j + 1] - bad_pt[i] == 0) & (bad_st[j] - bad_st[i] == 0)
        i, j = i[ok], j[ok]
        if len(i) == 0:
            continue
        vam = (e[j] - e[i]) / (t[j] - t[i]) * 3600.0
        k = int(np.argmax(vam))
        out[w] = (float(vam[k]), int(i[k]), int(j[k]))
    return out


def pct(xs, q):
    return float(np.percentile(xs, q)) if len(xs) else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="/tmp/climb-smoothing-streams")
    args = ap.parse_args()
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)

    s = session()
    athlete = env_value("EXPO_PUBLIC_ATHLETE_ID")
    acts = fetch_json(s, f"{BASE}/athlete/{athlete}/activities",
                      {"oldest": "2000-01-01T00:00:00", "limit": 5000})
    now = datetime.now(timezone.utc)
    eligible = []
    for a in acts:
        for fam, sports in FAMILIES.items():
            if a.get("type") in sports:
                eligible.append((fam, a))
    print(f"account: {len(acts)} activities, {len(eligible)} in a climbing family", file=sys.stderr)

    results = []  # (family, aid, start, {k: {w: vam}})
    counts = {"fetched": 0, "no_corrected": 0, "measured": 0}
    for n_done, (fam, a) in enumerate(eligible, 1):
        aid = a["id"]
        body = streams_for(s, cache, aid)
        counts["fetched"] += 1
        parsed = parse(body)
        if parsed is None:
            counts["no_corrected"] += 1
            continue
        t, e = parsed
        g = good_steps(t)
        per = {}
        for k in (1, 5, 9):
            per[k] = best_windows(t, smooth(e, g, k), g)
        start = datetime.fromisoformat(a["start_date"].replace("Z", "+00:00"))
        results.append((fam, aid, start, per))
        counts["measured"] += 1
        if n_done % 50 == 0:
            print(f"  {n_done}/{len(eligible)}", file=sys.stderr)
    print(json.dumps(counts), file=sys.stderr)

    lines = []
    lines.append(f"Library: {len(acts)} activities, {len(eligible)} in the Ride and Run climbing "
                 f"families, {counts['measured']} with usable corrected elevation, "
                 f"{counts['no_corrected']} without.")
    lines.append("")
    lines.append("Relative change of each activity's best, smoothed against unsmoothed, "
                 "over activities whose unsmoothed best is positive. Signed change is "
                 "(smoothed - unsmoothed) / unsmoothed.")
    lines.append("")
    lines.append("| family | window | mean | n | median | p90 | max | share over 3 % |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for fam in FAMILIES:
        for w in WINDOWS:
            for k in (5, 9):
                rel = []
                for f, aid, start, per in results:
                    if f != fam or w not in per[1] or w not in per[k]:
                        continue
                    u = per[1][w][0]
                    if u <= 0:
                        continue
                    rel.append(abs(per[k][w][0] - u) / u * 100)
                rel = np.array(rel)
                over = float((rel > 3).mean() * 100) if len(rel) else float("nan")
                lines.append(f"| {fam} | {w} s | {k} | {len(rel)} | {pct(rel, 50):.2f} % | "
                             f"{pct(rel, 90):.2f} % | {rel.max() if len(rel) else float('nan'):.2f} % | {over:.1f} % |")
    lines.append("")
    lines.append("Library best per family, window and period: the activity holding the "
                 "unsmoothed best, and whether the 5- and 9-sample means move it to another "
                 "activity. Value change is the smoothed holder's best against the unsmoothed "
                 "holder's best.")
    lines.append("")
    lines.append("| family | period | window | unsmoothed best | holder | 5: holder changes | 5: value | 9: holder changes | 9: value |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    changes = {5: 0, 9: 0}
    cells = 0
    for fam in FAMILIES:
        for pname, days in PERIOD_DAYS.items():
            since = now - timedelta(days=days) if days else None
            pool = [r for r in results if r[0] == fam and (since is None or r[2] >= since)]
            for w in WINDOWS:
                def holder(k):
                    cands = [(per[k][w][0], aid) for _, aid, _, per in pool if w in per[k]]
                    return max(cands) if cands else None
                u = holder(1)
                if u is None:
                    continue
                cells += 1
                row = f"| {fam} | {pname} | {w} s | {u[0]:.0f} m/h | {u[1]} |"
                for k in (5, 9):
                    hk = holder(k)
                    moved = hk is not None and hk[1] != u[1]
                    changes[k] += moved
                    delta = f"{(hk[0] - u[0]) / u[0] * 100:+.2f} %" if hk and u[0] > 0 else "n/a"
                    row += f" {'yes' if moved else 'no'} | {delta} |"
                lines.append(row)
    lines.append("")
    lines.append(f"Holder changes: 5-sample {changes[5]} of {cells} family/period/window cells, "
                 f"9-sample {changes[9]} of {cells}.")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
