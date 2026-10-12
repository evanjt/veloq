import { selectStatusMessage } from '@/features/recording/lib/statusSlot';

const SPLIT = { text: 'km 5 · 5:00 /km', spoken: 'Kilometre 5, 5 minutes per kilometre' };

const NOTHING = {
  backgroundTrackingWarning: null,
  gpsWarning: null,
  sensorIssue: null,
  splitBanner: null,
};

describe('selectStatusMessage', () => {
  it('returns null when nothing is active', () => {
    expect(selectStatusMessage(NOTHING)).toBeNull();
  });

  it('shows a lone split toast', () => {
    expect(selectStatusMessage({ ...NOTHING, splitBanner: SPLIT })).toEqual({
      kind: 'split',
      text: 'km 5 · 5:00 /km',
      spoken: 'Kilometre 5, 5 minutes per kilometre',
    });
  });

  it('sensor issue beats split toast', () => {
    expect(selectStatusMessage({ ...NOTHING, sensorIssue: 'HR lost', splitBanner: SPLIT })).toEqual(
      { kind: 'sensor', text: 'HR lost', spoken: 'HR lost' }
    );
  });

  it('gps warning beats a sensor issue and a split', () => {
    expect(
      selectStatusMessage({
        ...NOTHING,
        gpsWarning: 'weak',
        sensorIssue: 'HR lost',
        splitBanner: SPLIT,
      })
    ).toEqual({ kind: 'gps', text: 'weak', spoken: 'weak' });
  });

  /**
   * A weak signal costs accuracy. A refused foreground service costs the whole
   * ride the moment the screen goes, so it outranks the lot.
   */
  it('a refused foreground service beats everything', () => {
    expect(
      selectStatusMessage({
        backgroundTrackingWarning: 'no background tracking',
        gpsWarning: 'weak',
        sensorIssue: 'HR lost',
        splitBanner: SPLIT,
      })
    ).toEqual({
      kind: 'background',
      text: 'no background tracking',
      spoken: 'no background tracking',
    });
  });

  it('treats empty strings as absent', () => {
    expect(
      selectStatusMessage({
        backgroundTrackingWarning: '',
        gpsWarning: '',
        sensorIssue: '',
        splitBanner: { text: '', spoken: '' },
      })
    ).toBeNull();
  });
});

describe('a GPS warning the settings page can clear', () => {
  it('carries the settings action with its text', () => {
    expect(
      selectStatusMessage({ ...NOTHING, gpsWarning: 'denied', gpsWarningOpensSettings: true })
    ).toEqual({ kind: 'gps', text: 'denied', spoken: 'denied', opensSettings: true });
  });

  it('is a plain warning otherwise', () => {
    expect(
      selectStatusMessage({ ...NOTHING, gpsWarning: 'weak', gpsWarningOpensSettings: false })
    ).toEqual({ kind: 'gps', text: 'weak', spoken: 'weak' });
  });
});
