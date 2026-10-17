/**
 * Scenario: a font file lands under `assets/fonts/` without the OFL text the
 * licence requires to travel with it, or the `expo-font` plugin names a file
 * the tree does not hold, which fails prebuild on whichever machine builds next.
 *
 * Expected behaviour: the guard passes fonts with their licence beside them and
 * a plugin entry naming only those files, and refuses a font with no licence, a
 * licence file that is not the OFL, and a plugin path with no font behind it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/check-font-licences.mjs');
const OFL = 'This Font Software is licensed under the SIL Open Font License, Version 1.1.\n';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function config(paths: string[]) {
  return {
    expo: {
      plugins: [
        'expo-router',
        [
          'expo-font',
          {
            ios: { fonts: paths },
            android: {
              fonts: [
                {
                  fontFamily: 'Quillwork',
                  fontDefinitions: paths.map((path, i) => ({ path, weight: 400 + i * 300 })),
                },
              ],
            },
          },
        ],
      ],
    },
  };
}

function runOn(files: Record<string, string>, appConfig: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'font-licences-'));
  roots.push(root);
  writeFileSync(join(root, 'app.json'), JSON.stringify(appConfig));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  try {
    execFileSync('node', [SCRIPT, '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output: '' };
  } catch (error) {
    const e = error as { status: number; stderr?: Buffer };
    return { status: e.status, output: String(e.stderr ?? '') };
  }
}

const PATHS = ['./assets/fonts/Quillwork-Regular.ttf', './assets/fonts/Quillwork-Bold.ttf'];
const FONTS = {
  'assets/fonts/Quillwork-Regular.ttf': 'font bytes',
  'assets/fonts/Quillwork-Bold.ttf': 'font bytes',
};

it('passes fonts with their licence beside them, named by the plugin', () => {
  const result = runOn({ ...FONTS, 'assets/fonts/Quillwork-OFL.txt': OFL }, config(PATHS));
  expect(result).toEqual({ status: 0, output: '' });
});

it('passes a tree with no fonts and no plugin entry', () => {
  expect(runOn({}, { expo: { plugins: [] } }).status).toBe(0);
});

it('refuses a font with no licence beside it', () => {
  const result = runOn(
    { ...FONTS, 'assets/fonts/Quillwork-OFL.txt': OFL, 'assets/fonts/Inkline-Bold.otf': 'x' },
    config(PATHS)
  );
  expect(result.status).toBe(1);
  expect(result.output).toContain('assets/fonts/Inkline-Bold.otf has no');
  expect(result.output).toContain('Inkline-OFL.txt');
  expect(result.output).not.toContain('Quillwork-Regular.ttf has no');
});

it('refuses a licence file that is not the OFL', () => {
  const result = runOn(
    { ...FONTS, 'assets/fonts/Quillwork-OFL.txt': 'All rights reserved.\n' },
    config(PATHS)
  );
  expect(result.status).toBe(1);
  expect(result.output).toContain('does not carry the SIL Open Font License');
});

it('refuses a plugin path on either platform with no font behind it', () => {
  const missing = './assets/fonts/Quillwork-SemiBold.ttf';
  const result = runOn(
    { ...FONTS, 'assets/fonts/Quillwork-OFL.txt': OFL },
    config([...PATHS, missing])
  );
  expect(result.status).toBe(1);
  expect(result.output.match(/Quillwork-SemiBold\.ttf, which is not a font/g)).toHaveLength(2);
});
