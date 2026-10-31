#!/usr/bin/env node

// Fails a device job when the app crashed during it, whether or not a retry passed.
//
// A flow suite retries every failed flow, so a crash on one launch in ten fails
// a flow, passes on the retry and leaves the job green. This reads what the
// device recorded over the whole run instead of what the flows asserted.
//
// Android: a logcat file holding the whole run. A line counts when it is a
// fatal exception, a native fatal signal or a Rust panic, and the process that
// wrote it belongs to the app's package. The package is learned from the lines
// that name a pid (`Process: <pkg>, PID: <n>`, `Start proc <n>:<pkg>/`,
// `pid <n> (<pkg>)`), so a crash of another app on the device is ignored.
//
// iOS: a directory of crash reports copied from the simulator host. A report
// counts when its file name starts with the app's process name.
//
// Usage: node scripts/check-app-crashes.mjs
//          [--logcat FILE] [--package com.veloq.app]
//          [--ios-reports DIR] [--process VeloqDev]
//
// Exit 0: no crash. 1: a crash, printed and added to the job summary.
// 2: the log is missing or empty, because a check that read nothing proves nothing.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

const logcatPath = flag('--logcat');
const iosDir = flag('--ios-reports');
const appPackage = flag('--package', 'com.veloq.app');
const iosProcess = flag('--process', 'Veloq');

const THREADTIME = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+(\d+)\s+\d+\s+[VDIWEF]\s+.*?:\s?(.*)$/;
const TIME = /^[VDIWEF]\/[^(]*\(\s*(\d+)\):\s?(.*)$/;

function parse(line) {
  const m = THREADTIME.exec(line) ?? TIME.exec(line);
  return m ? { pid: m[1], msg: m[2] } : null;
}

function isOurs(name) {
  const base = name.split(':')[0];
  return base === appPackage || base.startsWith(`${appPackage}.`);
}

const PID_NAMES = [
  /Process: ([\w.:]+), PID: (\d+)/,
  /Start proc (\d+):([\w.:]+)\//,
  /pid (\d+) \(([\w.:]+)\)/,
  /pid: (\d+), tid: \d+, name: .*>>> ([\w.:]+) <<</,
];

const CONTEXT_LINES = 6;

const CRASH = [
  [/FATAL EXCEPTION/, 'fatal exception'],
  [/Fatal signal \d+/, 'native fatal signal'],
  [/panicked at/, 'Rust panic'],
];

export function crashesInLogcat(text) {
  const lines = text.split('\n').map((raw) => ({ raw, parsed: parse(raw) }));
  const ours = new Set();
  for (const { parsed } of lines) {
    if (!parsed) continue;
    for (const [i, re] of PID_NAMES.entries()) {
      const m = re.exec(parsed.msg);
      if (!m) continue;
      const [pid, name] = i === 0 ? [m[2], m[1]] : [m[1], m[2]];
      if (isOurs(name)) ours.add(pid);
    }
  }
  const found = [];
  for (const [at, { raw, parsed }] of lines.entries()) {
    if (!parsed || !ours.has(parsed.pid)) continue;
    const kind = CRASH.find(([re]) => re.test(parsed.msg));
    if (!kind) continue;
    // The lines after a fatal exception carry the process and the stack.
    const following = lines
      .slice(at + 1, at + 1 + CONTEXT_LINES)
      .filter((l) => l.parsed?.pid === parsed.pid)
      .map((l) => l.raw);
    found.push({ kind: kind[1], line: [raw, ...following].join('\n') });
  }
  return found;
}

export function crashReports(names, processName) {
  return names.filter((n) => n.startsWith(processName) && /\.(ips|crash)$/.test(n));
}

function report(findings) {
  const body = findings.map((f) => `${f.kind}: ${f.line}`).join('\n');
  console.error(`The app crashed during this job:\n${body}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, `### The app crashed during this job\n\n\`\`\`\n${body}\n\`\`\`\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = [];
  if (logcatPath) {
    if (!existsSync(logcatPath) || statSync(logcatPath).size === 0) {
      console.error(`${logcatPath} is missing or empty, so the crash check read nothing.`);
      process.exit(2);
    }
    findings.push(...crashesInLogcat(readFileSync(logcatPath, 'utf8')));
  }
  if (iosDir && existsSync(iosDir)) {
    for (const name of crashReports(readdirSync(iosDir), iosProcess)) {
      findings.push({ kind: 'crash report', line: name });
    }
  }
  if (findings.length > 0) {
    report(findings);
    process.exit(1);
  }
}
