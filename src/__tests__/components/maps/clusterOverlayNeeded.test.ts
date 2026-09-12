/**
 * Scenario: the map draws its cluster counts itself. The React overlay beside
 * them exists only for accessibility and for Maestro, is invisible by default,
 * and re-queried the page on every pan settle regardless.
 *
 * Expected behaviour: the round trip happens when something is going to read
 * the nodes, and not otherwise.
 */

import { clusterOverlayNeeded } from '@/features/maps/components/regional/ClusterCountOverlay';

describe('clusterOverlayNeeded', () => {
  it('does nothing for an invisible overlay in a release build with no screen reader', () => {
    expect(clusterOverlayNeeded({ visible: false, screenReaderOn: false, underTest: false })).toBe(
      false
    );
  });

  it.each([
    ['the overlay is shown', { visible: true, screenReaderOn: false, underTest: false }],
    ['a screen reader is on', { visible: false, screenReaderOn: true, underTest: false }],
    ['the build is one tests drive', { visible: false, screenReaderOn: false, underTest: true }],
  ])('queries the page when %s', (_why, options) => {
    expect(clusterOverlayNeeded(options)).toBe(true);
  });

  it('needs only one reason, not all of them', () => {
    expect(clusterOverlayNeeded({ visible: true, screenReaderOn: true, underTest: true })).toBe(
      true
    );
  });
});
