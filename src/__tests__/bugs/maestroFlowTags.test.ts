/**
 * Static guards for the Maestro flow suite.
 *
 * Scenario: flow tags drive CI selection (tier gates, pack pipelines), and
 * deep links into demo activities silently exercise the error screen when the
 * ID doesn't exist in the fixtures.
 * Expected behaviour: every flow carries exactly one tier tag; tier0-3 flows
 * carry exactly one known pack tag; tier4/5 flows carry none; and every
 * demo-prefixed deep link resolves to a real fixture activity ID.
 * Exception: by-file flows (smoke-build.yaml) are run by build.yml by file, not
 * by tag, and carry `prod-smoke` (no tier/pack) so no dev gate selects their
 * production appId.
 *
 * Also guards where captures land. `takeScreenshot` resolves its path against
 * the working directory, so a bare name drops a PNG beside `package.json`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fixtures } from '@/data/demo/fixtures';

const MAESTRO_DIR = path.resolve(__dirname, '../../../.maestro');

const KNOWN_PACKS = new Set([
  'pack-auth',
  'pack-nav',
  'pack-home',
  'pack-activity',
  'pack-map',
  'pack-fitness',
  'pack-training',
  'pack-routes',
  'pack-settings',
  'pack-data',
  'pack-stress',
  'pack-recording',
]);

// Run by build.yml by file (not by tag); tagged prod-smoke so no tier gate or
// pack pipeline ever launches its production appId against a dev build.
const BY_FILE_FLOWS = new Set(['smoke-build.yaml']);

const flowFiles = fs
  .readdirSync(MAESTRO_DIR)
  .filter((f) => f.endsWith('.yaml') && f !== 'config.yaml')
  .sort();

// Helpers and the upgrade pair live in subdirectories and capture too, so the
// screenshot guard walks the whole tree rather than the top level alone.
function allFlowFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return allFlowFiles(full);
      return entry.name.endsWith('.yaml') ? [path.relative(MAESTRO_DIR, full)] : [];
    })
    .sort();
}

const everyFlowFile = allFlowFiles(MAESTRO_DIR);

// The directory `.gitignore` already ignores, so a run leaves the tree clean.
const SCREENSHOT_DIR = 'screenshots/';

function readFlow(file: string): string {
  return fs.readFileSync(path.join(MAESTRO_DIR, file), 'utf8');
}

function header(content: string): string {
  const idx = content.indexOf('\n---');
  return idx === -1 ? content : content.slice(0, idx);
}

function tierTags(content: string): string[] {
  return [...header(content).matchAll(/^\s*-\s*(tier\d)\s*(?:#.*)?$/gm)].map((m) => m[1]);
}

function packTags(content: string): string[] {
  return [...header(content).matchAll(/^\s*-\s*(pack-[a-z]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
}

describe('maestro flow tags', () => {
  // Guards against MAESTRO_DIR resolving somewhere with no flows, which would
  // make every it.each below vacuous rather than failing.
  it('finds the flow suite', () => {
    expect(flowFiles.length).toBeGreaterThan(80);
  });

  it.each(flowFiles)('%s has exactly one tier tag', (file) => {
    const content = readFlow(file);
    if (BY_FILE_FLOWS.has(file)) {
      expect(tierTags(content)).toHaveLength(0);
      expect(content).toContain('prod-smoke');
      return;
    }
    expect(tierTags(content)).toHaveLength(1);
  });

  it.each(flowFiles)('%s pack tagging matches its tier', (file) => {
    const content = readFlow(file);
    if (BY_FILE_FLOWS.has(file)) {
      expect(packTags(content)).toHaveLength(0);
      return;
    }
    const tier = tierTags(content)[0];
    const packs = packTags(content);
    if (tier === 'tier4' || tier === 'tier5') {
      expect(packs).toHaveLength(0);
    } else {
      expect(packs).toHaveLength(1);
      expect(KNOWN_PACKS.has(packs[0])).toBe(true);
    }
  });
});

describe('maestro demo deep links', () => {
  const validIds = new Set(fixtures.activities.map((a) => a.id));

  it.each(flowFiles)('%s demo deep links resolve to fixture activities', (file) => {
    const content = readFlow(file);
    const linked = [...content.matchAll(/veloq:\/\/activity\/([\w-]+)/g)].map((m) => m[1]);
    // Non-demo IDs (e.g. "this-does-not-exist") are intentional error-state
    // probes; demo-prefixed IDs must exist or the flow tests the wrong screen.
    const demoLinks = linked.filter((id) => id.startsWith('demo-'));
    const unknown = demoLinks.filter((id) => !validIds.has(id));
    expect(unknown).toEqual([]);
  });
});

// Every step, counted without reading its path.
const SCREENSHOT_STEP = /^\s*-\s*takeScreenshot:/gm;

/** A YAML scalar's value: quoted either way, or plain up to a comment. */
function scalar(raw: string): string {
  const text = raw.trim();
  const quoted = text.match(/^"([^"]*)"|^'([^']*)'/);
  if (quoted) return quoted[1] ?? quoted[2];
  return text.replace(/\s+#.*$/, '');
}

/** The path of every `takeScreenshot` step, in each form Maestro accepts. */
function screenshotPaths(content: string): string[] {
  const lines = content.split('\n');
  const paths: string[] = [];
  lines.forEach((line, i) => {
    const step = line.match(/^(\s*)-\s*takeScreenshot:(.*)$/);
    if (!step) return;
    const inline = scalar(step[2]);
    if (inline) {
      paths.push(inline);
      return;
    }
    // The map form: `path:` among the keys indented under the step.
    for (const next of lines.slice(i + 1)) {
      if (next.trim() === '') continue;
      if (next.search(/\S/) <= step[1].length) break;
      const key = next.match(/^\s*path:(.*)$/);
      if (key) {
        paths.push(scalar(key[1]));
        break;
      }
    }
  });
  return paths;
}

describe('the screenshot path reader', () => {
  it.each([
    ['double-quoted', '- takeScreenshot: "screenshots/a"\n'],
    ['single-quoted', "- takeScreenshot: 'screenshots/a'\n"],
    ['unquoted', '- takeScreenshot: screenshots/a\n'],
    ['unquoted with a comment', '- takeScreenshot: screenshots/a # after login\n'],
    ['path: map', '- takeScreenshot:\n    path: screenshots/a\n'],
    ['quoted path: map', '- takeScreenshot:\n    path: "screenshots/a"\n'],
  ])('reads the %s form', (_form, flow) => {
    expect(screenshotPaths(`- launchApp\n${flow}- back\n`)).toEqual(['screenshots/a']);
  });

  it('reads one path per step across forms', () => {
    const flow = [
      '- takeScreenshot: after-login',
      "- takeScreenshot: 'screenshots/b'",
      '- takeScreenshot:',
      '    path: c',
      '- tapOn: "x"',
    ].join('\n');
    expect(screenshotPaths(flow)).toEqual(['after-login', 'screenshots/b', 'c']);
  });
});

describe('maestro screenshot paths', () => {
  it('finds the flow suite', () => {
    expect(everyFlowFile.length).toBeGreaterThan(80);
  });

  it('captures somewhere, so the guard below is not vacuous', () => {
    const total = everyFlowFile.reduce(
      (n, file) => n + [...readFlow(file).matchAll(SCREENSHOT_STEP)].length,
      0
    );
    expect(total).toBeGreaterThan(300);
  });

  it.each(everyFlowFile)('%s writes every capture under screenshots/', (file) => {
    const content = readFlow(file);
    const paths = screenshotPaths(content);
    // A form the reader cannot parse would otherwise pass unchecked.
    expect(paths).toHaveLength([...content.matchAll(SCREENSHOT_STEP)].length);
    const stray = paths.filter((p) => !p.startsWith(SCREENSHOT_DIR));
    expect(stray).toEqual([]);
  });
});
