/**
 * Scenario: the tile transport overrides two hooks the web view library never
 * publishes, a configuration method on iOS and the event emitter setup on
 * Android. A library upgrade that renames or rewrites either still compiles,
 * and the override is then never called, so no tile resolves or the crash
 * client is dropped.
 * Expected behaviour: the guard refuses any installed library whose hooks are
 * not the ones the overrides were written against.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/check-webview-hooks.mjs');
const LIBRARY = 'node_modules/react-native-webview';
const IMPL = 'apple/RNCWebViewImpl.m';
const MANAGER_HEADER = 'apple/RNCWebViewManager.h';
const MANAGER = 'android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java';
const FILES = ['package.json', IMPL, MANAGER_HEADER, MANAGER];

type Edit = { file: string; from: string | RegExp; to: string };

function run(root: string) {
  const result = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function withFixture(edits: Edit[], check: (root: string) => void, declared = '14.0.1') {
  const root = mkdtempSync(join(tmpdir(), 'webview-hooks-'));
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { 'react-native-webview': declared } })
    );
    for (const file of FILES) {
      const target = join(root, LIBRARY, file);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(ROOT, LIBRARY, file), target);
    }
    for (const { file, from, to } of edits) {
      const target = join(root, LIBRARY, file);
      const before = readFileSync(target, 'utf8');
      const after = before.replace(from, to);
      expect(after).not.toBe(before);
      writeFileSync(target, after);
    }
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('web view hook guard', () => {
  it('passes an unedited copy of the installed library', () => {
    withFixture([], (root) => expect(run(root)).toEqual({ status: 0, output: '' }));
  });

  it('refuses a renamed configuration method', () => {
    withFixture(
      [{ file: IMPL, from: /setUpWkWebViewConfig/g, to: 'makeWebViewConfiguration' }],
      (root) => {
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain('setUpWkWebViewConfig');
      }
    );
  });

  it('refuses a configuration method that setup no longer calls', () => {
    withFixture(
      [
        {
          file: IMPL,
          from: '[self setUpWkWebViewConfig]',
          to: '[WKWebViewConfiguration new]',
        },
      ],
      (root) => expect(run(root).status).toBe(1)
    );
  });

  it('refuses a configuration method whose return type changed', () => {
    withFixture(
      [
        {
          file: IMPL,
          from: '- (WKWebViewConfiguration *)setUpWkWebViewConfig',
          to: '- (void)setUpWkWebViewConfig',
        },
      ],
      (root) => expect(run(root).status).toBe(1)
    );
  });

  it('refuses a view manager that is no longer a legacy view manager', () => {
    withFixture([{ file: MANAGER_HEADER, from: ': RCTViewManager', to: ': NSObject' }], (root) =>
      expect(run(root).status).toBe(1)
    );
  });

  it('refuses an event emitter setup with an extra statement', () => {
    withFixture(
      [
        {
          file: MANAGER,
          from: 'view.getWebView().setWebViewClient(new RNCWebViewClient());',
          to: 'view.getWebView().setWebViewClient(new RNCWebViewClient());\n        view.getWebView().setWebChromeClient(null);',
        },
      ],
      (root) => {
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain('addEventEmitters');
      }
    );
  });

  it('refuses an event emitter setup that was renamed away', () => {
    withFixture(
      [{ file: MANAGER, from: 'void addEventEmitters(', to: 'void attachEmitters(' }],
      (root) => expect(run(root).status).toBe(1)
    );
  });

  it('refuses another installed version, even with the same hooks', () => {
    withFixture(
      [{ file: 'package.json', from: '"version": "14.0.1"', to: '"version": "14.0.2"' }],
      (root) => {
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain('14.0.2');
      }
    );
  });

  it('refuses another declared version', () => {
    withFixture([], (root) => expect(run(root).status).toBe(1), '^14.0.1');
  });

  it('refuses when the library is not installed', () => {
    withFixture([], (root) => {
      rmSync(join(root, LIBRARY), { recursive: true });
      expect(existsSync(join(root, LIBRARY))).toBe(false);
      expect(run(root).status).toBe(1);
    });
  });
});
