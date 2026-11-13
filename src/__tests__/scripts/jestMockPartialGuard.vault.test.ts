/**
 * Scenario: backupExclusion mocked `expo-modules-core` with a factory that
 * returned one function. Every other export the module graph took from it was
 * then undefined, and CI failed on a load order the machine here never hit.
 *
 * Expected behaviour: the guard fails a `jest.mock` factory for a package that
 * loads under Jest unless it spreads `jest.requireActual`, delegates to a
 * shared mock under `__tests__/__shared__/` that does, or names a package on
 * the allowlist. Local modules, factory-less mocks and non-test files are left
 * alone, and this repository passes.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-jest-mock-partial.mjs');

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
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
  const root = mkdtempSync(join(tmpdir(), 'jest-mock-partial-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails a whole-module factory for a package that loads under Jest', () => {
  const root = fixture({
    'src/__tests__/native/backupExclusion.test.ts': [
      "jest.mock('expo-modules-core', () => ({",
      '  requireOptionalNativeModule: jest.fn(),',
      '}));',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/native/backupExclusion.test.ts:1');
  expect(output).toContain('expo-modules-core');
});

it('fails a factory that loads some other module rather than the one it replaces', () => {
  const root = fixture({
    'src/__tests__/a.test.tsx': [
      "jest.mock('react-i18next', () => {",
      "  const en = jest.requireActual('@/i18n/locales/en-GB.json');",
      '  return { useTranslation: () => ({ t: (k: string) => en[k] ?? k }) };',
      '});',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/a.test.tsx:1  react-i18next');
});

it('fails a factory that takes one export of the actual module without spreading it', () => {
  const root = fixture({
    'src/__tests__/a.test.tsx': [
      "jest.mock('expo-router', () => ({",
      "  Link: jest.requireActual('expo-router').Link,",
      '  useRouter: jest.fn(),',
      '}));',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/a.test.tsx:1  expo-router');
});

it('fails a block factory that loads the actual module and returns a bare object', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('expo-file-system/legacy', () => {",
      "  const { documentDirectory } = jest.requireActual('expo-file-system/legacy');",
      '  return { documentDirectory };',
      '});',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/a.test.ts:1  expo-file-system/legacy');
});

it('passes a block factory that spreads the actual module through a variable', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('expo-modules-core', () => {",
      "  const actual = jest.requireActual<object>('expo-modules-core');",
      '  return { ...actual, requireOptionalNativeModule: jest.fn() };',
      '});',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('fails a shared mock that spreads the actual module of some other package', () => {
  const root = fixture({
    'src/__tests__/__shared__/i18nMock.ts': [
      'export function keysOnly() {',
      "  return { ...jest.requireActual('i18next'), useTranslation: jest.fn() };",
      '}',
    ].join('\n'),
    'src/__tests__/a.test.ts':
      "jest.mock('react-i18next', () => require('@/__tests__/__shared__/i18nMock').keysOnly());\n",
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/__shared__/i18nMock.ts');
});

it('fails a spread of the actual module nested inside the object it returns', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('expo-router', () => ({",
      "  Link: { ...jest.requireActual('expo-router') },",
      '  useRouter: jest.fn(),',
      '}));',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(1);
});

it('passes a block factory that returns an object it built by spreading the actual module', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('expo-router', () => {",
      "  const actual = jest.requireActual('expo-router');",
      '  const mocked = { ...actual, useRouter: jest.fn() };',
      '  return mocked;',
      '});',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('fails a factory whose spread of the actual module sits in a function nested inside what it returns', () => {
  const root = fixture({
    'src/__tests__/a.test.tsx': [
      "jest.mock('expo-router', () => ({",
      "  useRouter: () => ({ ...jest.requireActual('expo-router') }),",
      '}));',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/a.test.tsx:1  expo-router');
});

it('fails a block factory that holds an unused helper spreading the actual module and returns a bare object', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('expo-file-system/legacy', () => {",
      "  const unused = () => ({ ...jest.requireActual('expo-file-system/legacy') });",
      "  return { documentDirectory: '/x' };",
      '});',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/a.test.ts:1  expo-file-system/legacy');
});

it('fails a block factory that returns a bare object on one of its branches', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('expo-file-system/legacy', () => {",
      "  if (process.env.CI) return { documentDirectory: '/x' };",
      "  return { ...jest.requireActual('expo-file-system/legacy'), documentDirectory: '/x' };",
      '});',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(1);
});

it('fails a shared mock whose delegated export returns a bare object beside a helper that spreads', () => {
  const root = fixture({
    'src/__tests__/__shared__/i18nMock.ts': [
      'function unused() {',
      "  return { ...jest.requireActual('react-i18next') };",
      '}',
      'export function keysOnly() {',
      '  return { useTranslation: jest.fn() };',
      '}',
    ].join('\n'),
    'src/__tests__/a.test.ts':
      "jest.mock('react-i18next', () => require('./__shared__/i18nMock').keysOnly());\n",
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/__shared__/i18nMock.ts');
});

it('passes a shared mock whose delegated export returns a local helper that spreads the actual module', () => {
  const root = fixture({
    'src/__tests__/__shared__/i18nMock.ts': [
      'function withT(t: (key: string) => string) {',
      "  return { ...jest.requireActual('react-i18next'), useTranslation: () => ({ t }) };",
      '}',
      'export function keysOnly() {',
      '  return withT((key) => key);',
      '}',
    ].join('\n'),
    'src/__tests__/a.test.ts':
      "jest.mock('react-i18next', () => require('./__shared__/i18nMock').keysOnly());\n",
  });

  expect(runGuard(root).status).toBe(0);
});

it('reads a name bound inside the factory, not one of the same name in another factory', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('react-i18next', () => {",
      "  const actual = jest.requireActual('react-i18next');",
      '  return { ...actual, useTranslation: jest.fn() };',
      '});',
      "jest.mock('@/shared/app', () => {",
      "  const actual = jest.requireActual('@/shared/app');",
      '  return { ...actual };',
      '});',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('fails a whole-module jest.doMock as it fails a jest.mock', () => {
  const root = fixture({
    'src/__tests__/b.test.ts': [
      "it('x', () => {",
      "  jest.doMock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));",
      '});',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/b.test.ts:2  expo-secure-store');
});

it('fails a factory with a block body that returns a bare object', () => {
  const root = fixture({
    'src/__tests__/a.test.tsx': [
      "jest.mock('react-native-safe-area-context', () => {",
      "  const { View } = require('react-native');",
      '  return { SafeAreaView: View };',
      '});',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(1);
});

it('fails the global mocks in the setup file too', () => {
  const root = fixture({
    'config/jest.setup.js': "jest.mock('expo-constants', () => ({ expoConfig: {} }));\n",
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('config/jest.setup.js:1');
});

it('passes a factory that spreads the actual module', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('expo-modules-core', () => ({",
      "  ...jest.requireActual('expo-modules-core'),",
      '  requireOptionalNativeModule: jest.fn(),',
      '}));',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('passes a factory that delegates to a shared mock which spreads the actual module', () => {
  const root = fixture({
    'src/__tests__/__shared__/i18nMock.ts': [
      'export function keysOnly() {',
      "  return { ...jest.requireActual('react-i18next'), useTranslation: jest.fn() };",
      '}',
    ].join('\n'),
    'src/__tests__/a.test.ts':
      "jest.mock('react-i18next', () => require('@/__tests__/__shared__/i18nMock').keysOnly());\n",
  });

  expect(runGuard(root).status).toBe(0);
});

it('fails a delegation to a shared mock that does not spread the actual module', () => {
  const root = fixture({
    'src/__tests__/__shared__/i18nMock.ts':
      'export function keysOnly() { return { useTranslation: jest.fn() }; }\n',
    'src/__tests__/a.test.ts':
      "jest.mock('react-i18next', () => require('./__shared__/i18nMock').keysOnly());\n",
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/__shared__/i18nMock.ts');
});

it('leaves an allowlisted package, a local module and an automock alone', () => {
  const root = fixture({
    'src/__tests__/a.test.ts': [
      "jest.mock('react-native-iap', () => ({ useIAP: jest.fn() }));",
      "jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));",
      "jest.mock('./sibling', () => ({ run: jest.fn() }));",
      "jest.mock('expo-router');",
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('ignores a jest.mock outside the test tree and the setup files', () => {
  const root = fixture({
    'src/shared/example.ts': "jest.mock('expo-router', () => ({}));\n",
  });

  expect(runGuard(root).status).toBe(0);
});
