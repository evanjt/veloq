/**
 * Scenario: both comment guards skipped any line that did not start with a
 * comment marker, and had no syntax for XML.
 *
 * Expected behaviour: a comment trailing code, and a comment in an XML, plist
 * or entitlements file, is read like a whole-line one. A marker inside a string
 * literal is not a comment.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initFixtureRepo, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPTS = join(__dirname, '../../../scripts');
const AUDIT_IDS = join(SCRIPTS, 'lint-audit-ids.mjs');
const LINE_REFS = join(SCRIPTS, 'lint-comment-line-refs.mjs');

function status(script: string, root: string): number {
  try {
    execFileSync('node', [script, '--root', root], {
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'comment-forms-'));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('audit-id guard', () => {
  it.each([
    ['a trailing slash comment', 'src/a.ts', 'export const a = 1; // Fixed for `B1234`.\n'],
    ['a trailing parenthesised id', 'src/a.ts', 'export const a = 1; // (B999) kept\n'],
    ['a trailing block comment', 'src/a.ts', 'export const a = 1; /* `Q65` */\n'],
    ['a trailing hash comment', 'run.sh', 'echo hi # Fixed for `B1234`.\n'],
    [
      'an XML comment',
      'android/AndroidManifest.xml',
      '<manifest>\n  <!-- Kept for `B1234`. -->\n</manifest>\n',
    ],
    ['a multi-line XML comment', 'a.plist', '<!--\n  Kept for `B1234`.\n-->\n<plist/>\n'],
    ['an entitlements comment', 'x.entitlements', '<plist/> <!-- `B1234` -->\n'],
  ])('fails on %s', (_name, path, body) => {
    expect(status(AUDIT_IDS, fixture({ [path]: body }))).toBe(1);
  });

  it('passes on a marker inside a string and on XML without comments', () => {
    expect(
      status(
        AUDIT_IDS,
        fixture({
          'src/a.ts': 'export const a = \'http://x/`B1234`\';\nexport const b = "// `B1234`";\n',
          'run.sh': 'echo "${#arr} `B1234`"\n',
          'a.xml': '<a name="`B1234`"/>\n',
        })
      )
    ).toBe(0);
  });
});

describe('line-reference guard', () => {
  it.each([
    ['a trailing slash comment', 'src/a.ts', 'export const a = 1; // see login.tsx:54\n'],
    ['a trailing hash comment', 'run.sh', 'echo hi # see line 54\n'],
    [
      'an XML comment',
      'android/AndroidManifest.xml',
      '<manifest>\n  <!-- see Main.kt:12 -->\n</manifest>\n',
    ],
  ])('fails on %s', (_name, path, body) => {
    expect(status(LINE_REFS, fixture({ [path]: body }))).toBe(1);
  });

  it('passes on a citation inside a string', () => {
    expect(
      status(LINE_REFS, fixture({ 'src/a.ts': "export const a = 'see login.tsx:54';\n" }))
    ).toBe(0);
  });
});
