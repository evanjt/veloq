/**
 * Scenario: 26 test files wrote their own `jest.mock('veloqrs', ...)` beside
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

/**
 * The index of the parenthesis that closes the call opened at `open`. String
 * literals and comments are skipped, so a quote or an apostrophe inside either
 * cannot end the scan early.
 */
function closingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) {
        if (source[i] === '\\') i++;
      }
    } else if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      if (end < 0) return source.length;
      i = end;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return source.length;
      i = end + 1;
    } else if (c === '(') {
      depth++;
    } else if (c === ')' && --depth === 0) {
      return i;
    }
  }
  return source.length;
}

/** The factory text of every `jest.mock('veloqrs', ...)` in one source. */
function engineMockFactories(source: string): string[] {
  return [...source.matchAll(/jest\.mock\(\s*'veloqrs'\s*,\s*\(\)\s*=>/g)].map((match) => {
    const open = match.index + match[0].indexOf('(');
    return source.slice(open, closingParen(source, open));
  });
}

/** The factory body of every `jest.mock('veloqrs', ...)` in the tree. */
function engineMocks(): { file: string; factory: string }[] {
  return testFiles(TESTS).flatMap((file) =>
    engineMockFactories(readFileSync(file, 'utf-8')).map((factory) => ({
      file: relative(TESTS, file),
      factory,
    }))
  );
}

describe('mocking the engine binding', () => {
  it('is done somewhere, or this guard is testing nothing', () => {
    expect(engineMocks().length).toBeGreaterThan(20);
  });

  it('reads the whole factory, so a stub named after a long preamble still counts', () => {
    const source = [
      "jest.mock('veloqrs', () => {",
      `  const note = '${'x'.repeat(150)}';`,
      "  return require('../__shared__/veloqrsStub').withOverrides({});",
      '});',
    ].join('\n');

    const [factory] = engineMockFactories(source);

    expect(factory).toContain('veloqrsStub');
  });

  it('ends the factory at its own call, past an apostrophe in a comment', () => {
    const source = [
      "jest.mock('veloqrs', () => {",
      "  // the stub isn't reached here",
      '  return { basemapStore: () => null };',
      '});',
      "const later = require('../__shared__/veloqrsStub');",
    ].join('\n');

    const [factory] = engineMockFactories(source);

    expect(factory).not.toContain('veloqrsStub');
  });

  it('always goes through the shared stub', () => {
    const bespoke = engineMocks()
      .filter(({ factory }) => !factory.includes('veloqrsStub'))
      .map(({ file }) => file);

    expect(bespoke).toEqual([]);
  });
});
