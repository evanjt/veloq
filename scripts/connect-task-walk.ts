#!/usr/bin/env tsx
// Walks the tasks an athlete opens the connect site for, on the demo phone in
// the headless harness, and counts what each costs: page changes, clicks and
// the scrolls needed before the answer is in view, and whether the answer sits
// on the first screen. Every walk starts where the connection puts the page.
//
// Usage: npx tsx scripts/connect-task-walk.ts [--sizes 1440x900,1920x1080] [--tasks a,b] [--out <dir>]
//
// Prints one Markdown table per size. `--out` also writes a PNG of each
// task's answer state.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { phoneScript } from '../src/__tests__/__shared__/connectPhoneScripts';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectPage,
} from '../src/__tests__/__shared__/headlessConnectPage';

type Step =
  /** Click the first element matching `click`, or the first whose text starts with `text`. */
  | { click: string; text?: string; ctrl?: boolean; note?: string }
  /** Type into an input, as one act. */
  | { type: string; value: string }
  /** Press a key on the focused element, as one act. */
  | { key: string }
  /** Hold until an expression is true; costs nothing. */
  | { until: string };

interface Task {
  id: string;
  question: string;
  steps: Step[];
  /** The element that answers the question. */
  answer: string;
  /** What the answer is, for the table. */
  answerName: string;
}

const link = (hash: string) => `nav a[href="${hash}"]`;
const row = (table: string, at = 0) =>
  `${table} tbody tr[data-row]:nth-of-type(${at + 1}) td:nth-of-type(2)`;

export const TASKS: Task[] = [
  {
    id: 'latest-activity',
    question: 'How did my latest activity go?',
    steps: [
      { click: row('#feed'), note: 'the row selects and previews' },
      { click: '#detail-pane a.open-activity' },
    ],
    answer: '#activity-summary',
    answerName: 'the key figures and map of the activity page',
  },
  {
    id: 'versus-last-time',
    question: 'How did it compare with my other rides of this route?',
    steps: [
      { click: row('#feed') },
      { click: '#detail-pane a.open-activity' },
      { click: '#activity-tables [role="tab"]', text: 'Route' },
    ],
    answer: '#activity-tables table',
    answerName: 'the Route tab: rides, best, average, gap to best',
  },
  {
    id: 'getting-fitter',
    question: 'Am I getting fitter?',
    steps: [{ click: link('#/fitness') }],
    answer: '#panel-wellness-chart figure',
    answerName: 'the fitness tiles and the fitness and fatigue chart',
  },
  {
    id: 'sections-to-review',
    question: 'Which sections are waiting for my review?',
    steps: [{ click: link('#/sections') }],
    answer: '#sections-page button.ui-button-primary, #sections-list button[disabled]',
    answerName: 'the "Accept all (N to review)" button',
  },
  {
    id: 'sections-to-merge',
    question: 'Which sections could be merged with a neighbour?',
    steps: [
      { click: link('#/sections') },
      { click: row('#sections') },
      { click: '#sections-selection a.section-open' },
      { click: '#section-body [role="tab"]', text: 'Merge' },
    ],
    answer: '#section-body table',
    answerName: 'the Merge tab of one section; no page lists candidates across sections',
  },
  {
    id: 'hide-from-heatmap',
    question: 'Hide one commute from the heatmap (a run of them costs this per activity)',
    steps: [
      { click: row('#feed') },
      { click: '#detail-pane a.open-activity' },
      { click: '#activity-header button[aria-haspopup="menu"]' },
      { click: '[role="menuitem"]', text: 'Manage' },
      { click: '#activity-manage input[role="switch"]' },
    ],
    answer: '#activity-manage input[role="switch"]',
    answerName: "the heatmap switch in the activity's Manage panel",
  },
  {
    id: 'plan-workout',
    question: 'Plan my next strength workout',
    steps: [
      { click: link('#/workouts') },
      { click: '#workouts button', text: 'Blank workout' },
      { click: row('#workout-picker'), note: 'adds the exercise' },
      { until: `document.querySelectorAll('#workout-exercises li').length > 0` },
      { type: '#workouts input[type="text"]:not([aria-label])', value: 'Thursday push' },
      { click: '#workouts button', text: 'Save workout' },
    ],
    answer: '#workout-exercises',
    answerName: 'the saved workout with its exercises',
  },
  {
    id: 'section-best-and-trend',
    question: 'What is my best on this section and am I getting faster on it?',
    steps: [
      { click: link('#/sections') },
      { click: row('#sections') },
      { click: '#sections-selection a.section-open' },
    ],
    answer: '#section-body #panel-time figure',
    answerName: 'the section page: facts, stats and the Over time chart',
  },
  {
    id: 'where-ridden',
    question: 'Where have I ridden? (the map framed on my activities)',
    steps: [{ click: link('#/map') }, { click: '#map-layers button', text: 'Fit all activities' }],
    answer: '#map-stage canvas',
    answerName: 'the heatmap framed on the library',
  },
  {
    id: 'week-versus-last',
    question: 'How much did I train this week against last, and this season?',
    steps: [
      { click: link('#/fitness') },
      { click: '#fitness-page [role="tab"]', text: 'Calendar' },
    ],
    answer: '#comparisons',
    answerName: 'the Week and season table under the calendar',
  },
  {
    id: 'find-activity',
    question: 'Find an activity by name and open it',
    steps: [
      { click: '#topbar-palette' },
      { type: '#palette-input', value: 'Vineyard' },
      { until: `document.querySelector('.palette-list li[data-kind="Activity"]') !== null` },
      { click: '.palette-list li[data-kind="Activity"]' },
    ],
    answer: '#activity-summary',
    answerName: 'the activity page',
  },
  {
    id: 'recent-records',
    question: 'Did I set any records recently?',
    steps: [{ click: link('#/insights') }],
    answer: '#recent-records',
    answerName: 'the Recent records table (the Section records card is above it)',
  },
  {
    id: 'update-ftp',
    question: 'Update my FTP',
    steps: [
      { click: link('#/settings') },
      { click: '#settings-list a', text: 'Thresholds and zones' },
    ],
    answer: '#settings-thresholds-Ride',
    answerName: 'the thresholds table with the FTP field',
  },
  {
    id: 'recording-uploaded',
    question: 'Did my last recording upload?',
    steps: [{ click: link('#/recordings') }],
    answer: '#recordings',
    answerName: 'the recordings table with its Upload column',
  },
  {
    id: 'muscle-balance',
    question: 'Which muscles am I neglecting?',
    steps: [{ click: link('#/strength') }],
    answer: '#strength-balance',
    answerName: 'the body figure and the Balance list',
  },
  {
    id: 'compare-two',
    question: 'Compare two activities side by side',
    steps: [{ click: row('#feed') }, { click: row('#feed', 1), ctrl: true }],
    answer: '#compare',
    answerName: 'the comparison table in the detail pane',
  },
  {
    id: 'route-progress',
    question: 'Am I improving on my most ridden route?',
    steps: [{ click: link('#/routes') }, { click: row('#routes-list') }],
    answer: '#routes-detail #panel-time figure',
    answerName: 'the route page: Over time chart and attempts',
  },
];

interface Result {
  task: Task;
  pages: number;
  clicks: number;
  scrolls: number;
  firstScreen: boolean | 'missing';
  /** Where the answer's top sat relative to the viewport before any scroll for it. */
  answerTop: number | null;
  path: string[];
  note: string;
}

const locate = (selector: string, text?: string) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${
    text ? `(e.textContent || '').trim().startsWith(${JSON.stringify(text)})` : 'true'
  })`;

const inView = (expression: string) =>
  `(() => { const e = ${expression}; if (!e) return null; const r = e.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight,
      visible: r.top >= 0 && r.bottom <= innerHeight && r.height > 0 }; })()`;

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function walk(page: ConnectPage, task: Task): Promise<Result> {
  await page.until(`document.querySelector('#status[data-state="connected"]') !== null`, 30_000);
  await page.until(`document.querySelectorAll('#feed tbody tr').length > 5`, 30_000);
  let pages = 0;
  let clicks = 0;
  let scrolls = 0;
  const path: string[] = [await page.evaluate<string>('location.hash')];
  const screenOf = (hash: string) => hash.split('?')[0];

  const bringIntoView = async (expression: string) => {
    const box = await page.evaluate<{ visible: boolean } | null>(inView(expression));
    if (box && !box.visible) {
      await page.evaluate(`${expression}.scrollIntoView({ block: 'center' })`);
      scrolls += 1;
      await settle(300);
    }
  };

  for (const step of task.steps) {
    const before = screenOf(await page.evaluate<string>('location.hash'));
    if ('until' in step) {
      await page.until(step.until, 10_000);
      continue;
    }
    if ('click' in step) {
      const target = locate(step.click, step.text);
      await page.until(`${target} !== undefined`, 10_000);
      await bringIntoView(target);
      await page.evaluate(
        `${target}.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: ${Boolean(step.ctrl)} }))`
      );
      clicks += 1;
    } else if ('type' in step) {
      const target = locate(step.type);
      await page.until(`${target} !== undefined`, 10_000);
      await bringIntoView(target);
      await page.evaluate(`(() => { const e = ${target}; e.focus();
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(e, ${JSON.stringify(step.value)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      clicks += 1;
    } else if ('key' in step) {
      await page.evaluate(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(step.key)}, bubbles: true }))`
      );
      clicks += 1;
    }
    await settle(700);
    const after = await page.evaluate<string>('location.hash');
    if (screenOf(after) !== before) pages += 1;
    path.push(after);
  }

  let note = '';
  try {
    await page.until(`${locate(task.answer)} !== undefined`, 10_000);
  } catch {
    note = 'answer never drew';
  }
  await settle(1_000);
  const box = await page.evaluate<{
    top: number;
    bottom: number;
    h: number;
    visible: boolean;
  } | null>(inView(locate(task.answer)));
  const firstScreen: Result['firstScreen'] =
    box === null ? 'missing' : scrolls === 0 && box.visible;
  if (box && !box.visible) {
    await page.evaluate(`${locate(task.answer)}.scrollIntoView({ block: 'center' })`);
    scrolls += 1;
    await settle(300);
  }
  return {
    task,
    pages,
    clicks,
    scrolls,
    firstScreen,
    answerTop: box?.top ?? null,
    path: [...new Set(path)],
    note,
  };
}

function table(results: Result[], size: string): string {
  const lines = [
    `Size ${size}. Steps are clicks plus scrolls, from the page the connection opens on.`,
    '',
    '| Task | Pages | Clicks | Scrolls | Steps | Answer on first screen | Answer |',
    '|------|------:|-------:|--------:|------:|------------------------|--------|',
  ];
  for (const r of results) {
    const first =
      r.firstScreen === 'missing'
        ? 'never drew'
        : r.firstScreen
          ? 'yes'
          : `no, top at ${r.answerTop} px`;
    lines.push(
      `| ${r.task.question} | ${r.pages} | ${r.clicks} | ${r.scrolls} | ${r.clicks + r.scrolls} | ${first} | ${r.task.answerName}${r.note ? ` (${r.note})` : ''} |`
    );
  }
  return lines.join('\n');
}

function argument(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const sizes = (argument('--sizes') ?? '1440x900,1920x1080').split(',').map((text) => {
    const [width, height] = text.split('x').map(Number);
    return { width: width as number, height: height as number };
  });
  const chosen = argument('--tasks')?.split(',');
  const tasks = chosen ? TASKS.filter((t) => chosen.includes(t.id)) : TASKS;
  const out = argument('--out');
  if (out) mkdirSync(out, { recursive: true });
  const executable = findChromium();
  if (!executable) throw new Error('no Chromium found; set CHROME_PATH');
  const built = buildPage();
  const browser = await launchConnectBrowser(executable, built.dir);
  const script = await phoneScript('demo');
  try {
    for (const size of sizes) {
      const results: Result[] = [];
      for (const task of tasks) {
        const page = await browser.open(script, 'en', { ...size, scheme: 'light' });
        try {
          const result = await walk(page, task);
          results.push(result);
          if (out) {
            writeFileSync(resolve(out, `${task.id}-${size.width}.png`), await page.screenshot());
          }
          const errors = page.errors().filter((e) => !e.includes('does not ship'));
          if (errors.length) console.error(`${task.id}: ${errors.slice(0, 2).join(' | ')}`);
        } catch (error) {
          results.push({
            task,
            pages: 0,
            clicks: 0,
            scrolls: 0,
            firstScreen: 'missing',
            answerTop: null,
            path: [],
            note: `failed: ${(error as Error).message.slice(0, 160)}`,
          });
        } finally {
          await page.close();
        }
      }
      console.log(`\n${table(results, `${size.width}x${size.height}`)}\n`);
      for (const r of results) console.log(`- ${r.task.id}: ${r.path.join(' > ')}`);
    }
  } finally {
    await browser.close();
    built.remove();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error.message ?? error));
    process.exit(1);
  });
}
