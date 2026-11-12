/**
 * Scenario: the iOS build pins one Xcode version, and the runner may carry a
 * different one than the step that selected it asked for.
 * Expected behaviour: the check passes only when `xcodebuild -version` reports
 * the pinned version, matching whole components, and the iOS workflow sets
 * that pin once and runs the check after selecting Xcode.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/check-xcode-version.mjs');
const WORKFLOW = resolve(__dirname, '../../../.github/workflows/build-ios.yml');

function check(expected: string, stdin: string) {
  return spawnSync('node', [SCRIPT, expected], { input: stdin, encoding: 'utf8' });
}

describe('check-xcode-version', () => {
  it('passes when the reported version is the pinned one', () => {
    expect(check('27.1', 'Xcode 27.1\nBuild version 18A100\n').status).toBe(0);
  });

  it('accepts a patch release of the pinned version', () => {
    expect(check('26.2', 'Xcode 26.2.1\nBuild version 17C53\n').status).toBe(0);
  });

  it('fails when the reported version differs', () => {
    const result = check('27.1', 'Xcode 26.2\nBuild version 17C52\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('27.1');
    expect(result.stderr).toContain('26.2');
  });

  it('does not take 27.10 for 27.1', () => {
    expect(check('27.1', 'Xcode 27.10\n').status).toBe(1);
  });

  it('fails on empty or unreadable output', () => {
    expect(check('27.1', '').status).toBe(1);
    expect(check('27.1', 'xcode-select: error: no developer tools\n').status).toBe(1);
  });
});

describe('build-ios.yml Xcode pin', () => {
  const text = readFileSync(WORKFLOW, 'utf8');

  it('sets the version once and selects it from that setting', () => {
    expect(text).toMatch(/^\s+XCODE_VERSION: '\d+\.\d+'$/m);
    expect(text).toMatch(/xcode-version: \$\{\{ env\.XCODE_VERSION \}\}/);
    expect(text).not.toMatch(/xcode-version: '/);
  });

  it('checks the selected version straight after selecting it', () => {
    const select = text.indexOf('- name: Setup Xcode');
    const verify = text.indexOf('check-xcode-version.mjs "$XCODE_VERSION"');
    expect(select).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(select);
    expect(verify - select).toBeLessThan(900);
  });
});
