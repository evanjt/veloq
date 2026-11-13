/**
 * Scenario: several agents build on this machine at once, and at a load average
 * above twenty a `waitFor` polling a render that normally settles in
 * milliseconds missed the library's 1,000 ms default. It happened twice in
 * unrelated suites, on trees whose diffs could not explain it, and a red full
 * run that means "the machine was busy" cannot be told from one that means the
 * code is broken.
 *
 * Expected behaviour: the wait is patient enough for a loaded machine and still
 * short enough to fail inside the test budget, so a wait that will never settle
 * reports the library's message and names what it was waiting for.
 */

import { getConfig } from '@testing-library/react-native/build/config';

import jestConfig from '../../../config/jest.config.js';

/** What the library ships, and what proved too short here. */
const LIBRARY_DEFAULT_MS = 1000;

describe('the async wait budget', () => {
  it('is more patient than the library default', () => {
    expect(getConfig().asyncUtilTimeout).toBeGreaterThan(LIBRARY_DEFAULT_MS);
  });

  it('fails inside the test budget, so the library reports rather than Jest', () => {
    expect(jestConfig.testTimeout).toBeGreaterThan(getConfig().asyncUtilTimeout);
  });

  it('still gives up, so a wait that never settles is a failure and not a hang', () => {
    expect(getConfig().asyncUtilTimeout).toBeLessThan(jestConfig.testTimeout);
    expect(Number.isFinite(getConfig().asyncUtilTimeout)).toBe(true);
  });
});
