/**
 * Scenario: the coverage gate excluded `src/app/**`, so 33 route files and
 * the activity detail screen could never appear in the number it reads, and
 * its thresholds sat twenty-five points under what the suite measured.
 *
 * Expected behaviour: the screens are counted, and the thresholds hold the
 * ground the tree has, so neither can be given back without this failing.
 */

import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require(join(__dirname, '../../../config/jest.config.js')) as {
  collectCoverageFrom: string[];
  coverageThreshold: { global: Record<string, number> };
};

describe('the coverage number counts the screens', () => {
  it('does not exclude src/app from the counted tree', () => {
    const excludesApp = config.collectCoverageFrom.some((glob) => /^!src\/app\b/.test(glob));
    expect(excludesApp).toBe(false);
  });

  it('holds thresholds seeded at what the suite measures, not the old floor', () => {
    const { branches, functions, lines, statements } = config.coverageThreshold.global;
    expect(branches).toBeGreaterThanOrEqual(49);
    expect(functions).toBeGreaterThanOrEqual(54);
    expect(lines).toBeGreaterThanOrEqual(57);
    expect(statements).toBeGreaterThanOrEqual(56);
  });
});
