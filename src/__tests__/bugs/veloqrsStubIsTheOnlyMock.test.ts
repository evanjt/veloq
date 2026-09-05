/**
 * Scenario: 26 test files wrote their own `// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('veloqrs', ...)` beside
 * the nine using the shared stub, so every FFI addition had up to 26 mocks to
 * find, and a test-only engine assertion once existed because one drifted.
 *
 * Expected behaviour: a test mocks the engine binding through the shared stub,
 * overriding the one method it cares about, and this guard names any file that
 * writes its own object literal instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const TESTS = resolve('src/__tests__');

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return testFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** The factory body of every `jest.mock('veloqrs', ...)` in the tree. */
function engineMocks(): { file: string; factory: string }[] {
  const found: { file: string; factory: string }[] = [];
  for (const file of testFiles(TESTS)) {
    const source = readFileSync(file, 'utf-8');
    for (const match of source.matchAll(
      /jest\.mock\(\s*'veloqrs'\s*,\s*\(\)\s*=>\s*([\s\S]{0,120})/g
    )) {
      found.push({ file: relative(TESTS, file), factory: match[1] });
    }
  }
  return found;
}

describe('mocking the engine binding', () => {
  it('is done somewhere, or this guard is testing nothing', () => {
    expect(engineMocks().length).toBeGreaterThan(20);
  });

  it('always goes through the shared stub', () => {
    const bespoke = engineMocks()
      .filter(({ factory }) => !factory.includes('veloqrsStub'))
      .map(({ file }) => file);

    expect(bespoke).toEqual([]);
  });
});
