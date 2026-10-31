#!/usr/bin/env node

// Writes why a Maestro job failed into the job summary, so the cause is read on
// the run page and not from a downloaded artifact.
//
// It names each flow the JUnit report marks failed, the newest screenshot under
// the debug directory and the crash lines of the app's own process
// (com.veloq.app) in the logcat. Each input is optional and a missing one is skipped.
//
// Usage: node scripts/maestro-failure-summary.mjs
//          [--report FILE.xml] [--debug DIR] [--logcat FILE]
//
// Always exits 0: it reports a failure and is not itself a gate.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { crashesInLogcat } from './check-app-crashes.mjs';

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** The names of the test cases in a JUnit report that carry a failure or an error. */
export function failedFlows(xml) {
  const names = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = m[3] ?? '';
    if (!/<(failure|error)\b/.test(body) && !/\bstatus="(FAILED|ERROR)"/.test(m[1])) continue;
    const name = /\bname="([^"]*)"/.exec(m[1]);
    if (name) names.push(unescapeXml(name[1]));
  }
  return names;
}

/** The path of the most recently written screenshot under a directory, or null. */
export function lastScreenshot(dir) {
  let best = null;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.png')) {
        const at = statSync(path).mtimeMs;
        if (!best || at > best.at) best = { path, at };
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return best?.path ?? null;
}

export function summary({ report, debug, logcat }) {
  const parts = [];
  if (report && existsSync(report)) {
    const flows = failedFlows(readFileSync(report, 'utf8'));
    if (flows.length > 0) {
      parts.push(`### Failed flows\n\n${flows.map((f) => `- ${f}`).join('\n')}`);
    }
  }
  const shot = debug ? lastScreenshot(debug) : null;
  if (shot) parts.push(`### Last screenshot\n\n\`${shot}\``);
  if (logcat && existsSync(logcat)) {
    const crashes = crashesInLogcat(readFileSync(logcat, 'utf8'));
    if (crashes.length > 0) {
      const body = crashes.map((c) => `${c.kind}: ${c.line}`).join('\n');
      parts.push(`### App crash lines\n\n\`\`\`\n${body}\n\`\`\``);
    }
  }
  return parts.join('\n\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const text = summary({
    report: flag('--report'),
    debug: flag('--debug'),
    logcat: flag('--logcat'),
  });
  if (text) {
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
}
