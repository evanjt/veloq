/**
 * Scenario: the data service writes its own name in lower case, and copy in the
 * locales, the website and the store listings drifted to a capital first letter,
 * including at the start of a sentence.
 *
 * Expected behaviour: the guard fails on any mixed-case spelling of the name in
 * a tracked file and names the line. The lower-case name, the all-capitals
 * section label and URLs pass.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-service-name.mjs');

// Assembled so this file does not hold the spelling it tests for.
const CAPITALISED = ['Intervals', 'icu'].join('.');

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'service-name-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails on a capitalised name in a locale and names the line', () => {
  const root = fixture({
    'src/i18n/locales/xx.json': `{\n  "login": {\n    "subtitle": "Join ${CAPITALISED}"\n  }\n}\n`,
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/i18n/locales/xx.json:3');
});

it('fails at the start of a sentence too, in store copy and the website', () => {
  const root = fixture({
    'config/fastlane/metadata/ios/xx/subtitle.txt': `${CAPITALISED} pocket viewer\n`,
    'docs/index.html': `<p>Fine.</p>\n<p>${CAPITALISED} holds the data.</p>\n`,
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('config/fastlane/metadata/ios/xx/subtitle.txt:1');
  expect(output).toContain('docs/index.html:2');
});

it('fails on any other mixed-case spelling', () => {
  const root = fixture({ 'docs/notes.txt': `${['Intervals', 'ICU'].join('.')}\n` });

  expect(runGuard(root).status).toBe(1);
});

it('passes the lower-case name, the all-capitals label and a URL', () => {
  const root = fixture({
    'src/i18n/locales/xx.json': '{ "subtitle": "Join intervals.icu" }\n',
    'src/app/about.tsx': '<Text>INTERVALS.ICU</Text>\n',
    'docs/index.html': '<a href="https://intervals.icu/settings">intervals.icu settings</a>\n',
  });

  const { status, output } = runGuard(root);

  expect(output).toBe('Service name guard: written in lower case throughout the tracked tree.\n');
  expect(status).toBe(0);
});
