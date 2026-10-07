/**
 * Scenario: Expo Doctor, `expo config` and every bundling step evaluate the app
 * configuration, plugins included. A plugin that compiles Rust or prints setup
 * output there slows every one of them, rewrites build products behind the
 * native build's back, and breaks the tools that parse the printed JSON.
 * Expected behaviour: reading the configuration prints JSON alone, starts no
 * native toolchain, and leaves the working tree as it found it.
 */

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitFreeEnv } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const EXPO = join(ROOT, 'node_modules/expo/bin/cli');
const TOOLS = ['cargo', 'rustc', 'rustup', 'xcodebuild', 'lipo', 'adb', 'gradle'];

let bin: string;
let marker: string;

function treeState() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  expect(result.status).toBe(0);
  return result.stdout;
}

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'expo-config-tools-'));
  marker = join(bin, 'started');
  for (const tool of TOOLS) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${marker}"\nexit 1\n`);
    chmodSync(join(bin, tool), 0o755);
  }
});

afterAll(() => {
  rmSync(bin, { recursive: true, force: true });
});

it.each([['--full'], ['--type', 'prebuild']])(
  'expo config --json %s prints parseable JSON and starts no native toolchain',
  (...flags) => {
    const before = treeState();

    const result = spawnSync('node', [EXPO, 'config', '--json', ...flags], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...gitFreeEnv(), PATH: `${bin}:${process.env.PATH}`, CI: '1' },
    });

    expect(result.status).toBe(0);
    const config = JSON.parse(result.stdout);
    expect(config.exp?.name ?? config.name).toBeTruthy();
    expect(existsSync(marker)).toBe(false);
    expect(treeState()).toBe(before);
  },
  60_000
);
