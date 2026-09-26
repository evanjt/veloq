/**
 * Scenario: an APK outlives the checkout it was built from. One cut at 13:14
 * was installed at 21:36 and ran eight hours behind main, with the fix it was
 * installed to test absent, and nothing in the file or on the phone said which
 * commit it was.
 *
 * Expected behaviour: the build stamp names the commit and whether the tree
 * was dirty, and one module computes it for the config, the footer and the
 * install script alike.
 */

import { formatVersionLine } from '@/shared/format/buildStamp';

const { buildStamp } = require('../../../scripts/lib/build-stamp.js');

describe('formatVersionLine', () => {
  it('names the commit beside the version', () => {
    expect(formatVersionLine('0.4.0', 'a8f276dff')).toBe('0.4.0 (a8f276dff)');
  });

  it('carries the dirty mark through', () => {
    expect(formatVersionLine('0.4.0', 'a8f276dff+')).toBe('0.4.0 (a8f276dff+)');
  });

  it('is the version alone when no stamp was recorded', () => {
    expect(formatVersionLine('0.4.0', undefined)).toBe('0.4.0');
    expect(formatVersionLine('0.4.0', '')).toBe('0.4.0');
  });
});

describe('buildStamp', () => {
  it('reads a short sha out of the checkout it runs in', () => {
    expect(buildStamp()).toMatch(/^[0-9a-f]{7,}\+?$/);
  });

  it('answers empty outside a checkout rather than throwing', () => {
    expect(buildStamp('/')).toBe('');
  });
});
