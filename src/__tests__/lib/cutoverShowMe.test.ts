/**
 * Scenario: a Show Me gated on the re-analysis would open a tab with no history
 * before the run has moved anything.
 *
 * Expected behaviour: the gate offers Show Me only once the run has settled
 * without failing and moved at least one section.
 */
import { cutoverHasChangesToShow } from '@/features/settings/lib/cutoverShowMe';
import { WHATS_NEW_SLIDES } from '@/features/settings/components/whatsNew/slides';

const MOVED = { current: 40, proposed: 42, unchanged: 35, changed: 3, new: 4, gone: 2 };

describe('cutoverHasChangesToShow', () => {
  it('is false while the run is in flight, even over the previous diff', () => {
    expect(cutoverHasChangesToShow({ phase: 'detecting', isRunning: true, counts: MOVED })).toBe(
      false
    );
  });

  it('is false before any run has stored a diff', () => {
    expect(cutoverHasChangesToShow({ phase: 'idle', isRunning: false, counts: null })).toBe(false);
  });

  it('is false for a run that came through unchanged', () => {
    const counts = { ...MOVED, changed: 0, new: 0, gone: 0 };
    expect(cutoverHasChangesToShow({ phase: 'complete', isRunning: false, counts })).toBe(false);
  });

  it('is false after a failure, which leaves the previous run diff', () => {
    for (const phase of ['failed', 'failed_after_apply'] as const) {
      expect(cutoverHasChangesToShow({ phase, isRunning: false, counts: MOVED })).toBe(false);
    }
  });

  it('is true once a settled run moved a section, one kind of move being enough', () => {
    expect(cutoverHasChangesToShow({ phase: 'complete', isRunning: false, counts: MOVED })).toBe(
      true
    );
    const onlyGone = { ...MOVED, changed: 0, new: 0, gone: 1 };
    expect(cutoverHasChangesToShow({ phase: 'complete', isRunning: false, counts: onlyGone })).toBe(
      true
    );
  });
});

describe('the 0.4.0 slide', () => {
  it('offers Show Me whatever the re-analysis did, since the detector settings always have content', () => {
    const [slide] = WHATS_NEW_SLIDES['0.4.0'];
    expect(slide.showMeRoute).toBe('/detection-settings');
    expect(slide.showMeWhen).toBeUndefined();
  });
});
