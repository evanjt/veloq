/**
 * Scenario: the App Store asks the export compliance question on every upload when the
 * declaration is missing, and a declaration of non-exempt encryption asks for paperwork
 * the app does not owe for standard TLS and DTLS.
 * Expected behaviour: the guard passes only when both declarations are the boolean
 * false, and when an iOS project exists its generated Info.plist carries the same key
 * as `<false/>`.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/check-export-compliance.mjs');
const KEY = 'ITSAppUsesNonExemptEncryption';
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

type Ios = { infoPlist?: unknown; config?: unknown };

function appJson(ios: Ios): string {
  const expo: Record<string, unknown> = { name: 'Veloq', ios: {} };
  const declarations = expo.ios as Record<string, unknown>;
  if (ios.infoPlist !== undefined) declarations.infoPlist = ios.infoPlist;
  if (ios.config !== undefined) declarations.config = ios.config;
  return JSON.stringify({ expo });
}

function plist(declaration: string | null): string {
  const entry = declaration === null ? '' : `\t<key>${KEY}</key>\n\t${declaration}\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${entry}</dict>\n</plist>\n`;
}

/** A temporary root with `app.json` and, when given, an app target under `ios/`. */
function root(
  json: string,
  options: { infoPlist?: string; folder?: string; appDelegate?: boolean } = {}
): string {
  const dir = mkdtempSync(join(tmpdir(), 'export-compliance-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'app.json'), json);
  if (options.infoPlist !== undefined) {
    const target = join(dir, 'ios', options.folder ?? 'Veloq');
    mkdirSync(target, { recursive: true });
    if (options.appDelegate !== false) writeFileSync(join(target, 'AppDelegate.swift'), '');
    writeFileSync(join(target, 'Info.plist'), options.infoPlist);
  }
  return dir;
}

function run(dir: string) {
  return spawnSync('node', [GUARD, '--root', dir], { encoding: 'utf8' });
}

const DECLARED: Ios = {
  infoPlist: { [KEY]: false },
  config: { usesNonExemptEncryption: false },
};

describe('export compliance declaration guard', () => {
  it('passes when both declarations are false and there is no iOS project', () => {
    expect(run(root(appJson(DECLARED))).status).toBe(0);
  });

  it('passes an iOS project whose generated Info.plist carries the key as false', () => {
    const dir = root(appJson(DECLARED), { infoPlist: plist('<false/>') });
    expect(run(dir).status).toBe(0);
  });

  it('fails and names the key when the Info.plist declaration is absent', () => {
    const result = run(root(appJson({ ...DECLARED, infoPlist: {} })));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(KEY);
  });

  it('fails and names the config declaration when it is absent', () => {
    const result = run(root(appJson({ ...DECLARED, config: {} })));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('usesNonExemptEncryption');
  });

  it('fails when the Info.plist declaration is true', () => {
    const result = run(root(appJson({ ...DECLARED, infoPlist: { [KEY]: true } })));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(KEY);
  });

  it('fails when the config declaration is true', () => {
    const result = run(root(appJson({ ...DECLARED, config: { usesNonExemptEncryption: true } })));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('usesNonExemptEncryption');
  });

  it('refuses the string "false", since only the boolean is a declaration', () => {
    const result = run(root(appJson({ ...DECLARED, infoPlist: { [KEY]: 'false' } })));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(KEY);
  });

  it('fails an iOS project whose generated Info.plist declares true', () => {
    const dir = root(appJson(DECLARED), { infoPlist: plist('<true/>') });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(KEY);
  });

  it('fails an iOS project whose generated Info.plist has dropped the key', () => {
    const dir = root(appJson(DECLARED), { infoPlist: plist(null) });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(KEY);
  });

  it('fails an iOS project with no app target folder rather than passing it', () => {
    const dir = root(appJson(DECLARED), {
      infoPlist: plist('<false/>'),
      folder: 'VeloqWidget',
      appDelegate: false,
    });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AppDelegate');
  });
});
