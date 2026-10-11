// What the app holds on the iOS simulator: its own footprint plus the WebKit
// helpers the simulator starts for it.
//
// The maps run in WebContent, GPU and Networking helpers parented by the
// simulator's `launchd_sim`, not by the app, so the app pid alone reads about
// half the total. The host runs WebKit helpers of its own under `launchd`, and
// a simulator helper can outlive an earlier launch, so a helper counts only
// when it shares the app's parent and started no earlier than the app did.

const WEBKIT_HELPER = /^com\.apple\.WebKit\./;

const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

/** Seconds from a `ps` elapsed time, `[[dd-]hh:]mm:ss`. */
function elapsedSeconds(etime) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(etime).trim());
  if (!match) throw new Error(`ios-memory: not an elapsed time: ${etime}`);
  const [, days = 0, hours = 0, minutes, seconds] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

/** Rows of `ps -axo pid=,ppid=,etime=,comm=`. A command path may hold spaces. */
function parsePs(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, etime, command] = match;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      elapsed: elapsedSeconds(etime),
      command,
      name: command.split('/').pop(),
    });
  }
  return rows;
}

/** The app and the WebKit helpers started for it, the app first, helpers by pid. */
function selectProcesses(psText, appPid) {
  const rows = parsePs(psText);
  const app = rows.find((row) => row.pid === Number(appPid));
  if (!app) throw new Error(`ios-memory: pid ${appPid} is not in the process list`);
  const helpers = rows
    .filter(
      (row) =>
        row.pid !== app.pid &&
        row.ppid === app.ppid &&
        WEBKIT_HELPER.test(row.name) &&
        row.elapsed <= app.elapsed
    )
    .sort((a, b) => a.pid - b.pid);
  return [
    { pid: app.pid, name: app.name, role: 'app' },
    ...helpers.map((row) => ({ pid: row.pid, name: row.name, role: 'webkit' })),
  ];
}

/** Each process's footprint in bytes from `footprint`, by pid. */
function parseFootprint(text) {
  const byPid = new Map();
  const header = /^(.+?) \[(\d+)\]: .*?Footprint: ([\d.]+) (B|KB|MB|GB)\b/;
  for (const line of text.split('\n')) {
    const match = header.exec(line.trim());
    if (!match) continue;
    const [, name, pid, amount, unit] = match;
    byPid.set(Number(pid), { name, bytes: Math.round(Number(amount) * UNITS[unit]) });
  }
  return byPid;
}

/**
 * One reading: the selected processes with their footprints and the sums. A
 * helper that exited between `ps` and `footprint` is named in `missing` rather
 * than counted as zero. The app is required.
 */
function readPoint(label, psText, footprintText, appPid) {
  const selected = selectProcesses(psText, appPid);
  const footprints = parseFootprint(footprintText);
  if (!footprints.has(Number(appPid))) {
    throw new Error(`ios-memory: footprint has no reading for the app, pid ${appPid}`);
  }
  const processes = [];
  const missing = [];
  for (const process of selected) {
    const reading = footprints.get(process.pid);
    if (reading) processes.push({ ...process, bytes: reading.bytes });
    else missing.push(process.pid);
  }
  const sum = (role) =>
    processes.filter((p) => p.role === role).reduce((total, p) => total + p.bytes, 0);
  const appBytes = sum('app');
  const helperBytes = sum('webkit');
  return { label, processes, missing, appBytes, helperBytes, totalBytes: appBytes + helperBytes };
}

/**
 * Each point of a run against the baseline's point of the same label. A point
 * fails when its total exceeds the baseline's by more than `maxRegression`, a
 * fraction. A run that shares no point with the baseline compares nothing and
 * fails.
 */
function compareRecords(record, baseline, maxRegression) {
  const before = new Map(baseline.points.map((point) => [point.label, point.totalBytes]));
  const rows = record.points
    .filter((point) => before.has(point.label))
    .map((point) => {
      const base = before.get(point.label);
      const ratio = point.totalBytes / base;
      return {
        label: point.label,
        totalBytes: point.totalBytes,
        baselineBytes: base,
        ratio,
        over: ratio > 1 + maxRegression,
      };
    });
  return { ok: rows.length > 0 && rows.every((row) => !row.over), rows };
}

module.exports = {
  elapsedSeconds,
  parsePs,
  selectProcesses,
  parseFootprint,
  readPoint,
  compareRecords,
};
