"""Summarise a sample.sh capture: per-thread CPU, parallelism and RSS over a run.

Usage: python3 analyse.py <capture> [start_uptime] [end_uptime]
"""
import re
import sys
from collections import defaultdict

HZ = 100


def parse(path):
    samples = []
    cur = None
    for line in open(path):
        p = line.split()
        if not p:
            continue
        if p[0] == "T":
            cur = {"t": float(p[1]), "threads": {}, "sched": {}, "rss": None, "cpu": None}
            samples.append(cur)
        elif p[0] == "cpu":
            v = list(map(int, p[1:]))
            cur["cpu"] = (sum(v), v[3] + v[4])
        elif p[0] == "VmRSS:":
            cur["rss"] = int(p[1]) // 1024
        elif p[0] == "S" and cur is not None:
            cur["sched"][p[1]] = (int(p[2]), int(p[3]))
        elif len(p) == 6 and cur is not None:
            tid, comm, ut, st, nice, proc = p
            cur["threads"][tid] = (comm, int(ut) + int(st), int(nice))
    return [s for s in samples if s["cpu"] and s["rss"]]


def group(comm):
    return re.sub(r"[-_]?\d+$", "", comm)


def main():
    samples = parse(sys.argv[1])
    lo = float(sys.argv[2]) if len(sys.argv) > 2 else samples[0]["t"]
    hi = float(sys.argv[3]) if len(sys.argv) > 3 else samples[-1]["t"]
    win = [s for s in samples if lo <= s["t"] <= hi]
    a, b = win[0], win[-1]
    span = b["t"] - a["t"]
    per = defaultdict(float)
    nice = {}
    for tid, (comm, ticks, n) in b["threads"].items():
        before = a["threads"].get(tid, (comm, 0, n))[1]
        per[(group(comm), tid)] += (ticks - before) / HZ
        nice[group(comm)] = n
    groups = defaultdict(lambda: [0.0, 0])
    for (g, _), sec in per.items():
        groups[g][0] += sec
        groups[g][1] += 1
    total = sum(per.values())
    print(f"window {span:.2f} s, {len(win)} samples, process CPU {total:.2f} s, mean {total / span:.2f} cores")
    print(f"threads {len(a['threads'])} -> {len(b['threads'])}, max {max(len(s['threads']) for s in win)}")
    print(f"RSS {a['rss']} -> {b['rss']} MB, peak {max(s['rss'] for s in win)} MB")
    dev_busy = (b["cpu"][0] - b["cpu"][1]) - (a["cpu"][0] - a["cpu"][1])
    print(f"device busy {dev_busy / HZ:.2f} CPU-s, mean {dev_busy / HZ / span:.2f} cores of 8")
    print("by thread group (CPU-s, threads, nice):")
    for g, (sec, n) in sorted(groups.items(), key=lambda kv: -kv[1][0])[:15]:
        if sec > 0:
            print(f"  {g:20} {sec:7.2f} {n:3} {nice.get(g)}")
    if b["sched"]:
        print("runqueue wait over the window (ms waited per s, ms ran per s):")
        for name in ("m.veloq.app.dev", "mqt_v_js", "RenderThread", "veloq-cpu", "veloq-detect", "veloq-tiles", "veloq-net"):
            run = wait = 0
            for tid, (comm, _, _) in b["threads"].items():
                if group(comm) != name or tid not in b["sched"]:
                    continue
                r0, w0 = a["sched"].get(tid, (0, 0))
                run += b["sched"][tid][0] - r0
                wait += b["sched"][tid][1] - w0
            if run or wait:
                print(f"  {name:20} wait {wait / 1e6 / span:7.1f}  run {run / 1e6 / span:7.1f}")
    peak = (0, None, None)
    js_in_peak = 0
    for i in range(1, len(win)):
        p, q = win[i - 1], win[i]
        dt = q["t"] - p["t"]
        if dt <= 0:
            continue
        busy = 0
        js = 0
        for tid, (comm, ticks, _) in q["threads"].items():
            d = (ticks - p["threads"].get(tid, (comm, ticks, 0))[1]) / HZ
            busy += d
            if comm == "mqt_v_js":
                js += d
        if busy / dt > peak[0]:
            peak = (busy / dt, q["t"], dt)
            js_in_peak = js / dt
        dev = ((q["cpu"][0] - q["cpu"][1]) - (p["cpu"][0] - p["cpu"][1])) / HZ / dt
        q["dev"] = dev
    print(f"peak process parallelism {peak[0]:.2f} cores at {peak[1]:.2f} over {peak[2]:.2f} s, JS thread {js_in_peak:.2f}")
    print(f"peak device load {max(s.get('dev', 0) for s in win):.2f} cores")


if __name__ == "__main__":
    main()
