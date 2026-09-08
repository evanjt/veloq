import { selectStatusMessage } from '@/features/recording/lib/statusSlot';

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
    expect(selectStatusMessage({ ...NOTHING, splitBanner: 'km 5' })).toEqual({
      kind: 'split',
      text: 'km 5',
    });
  });

  it('sensor issue beats split toast', () => {
    expect(
      selectStatusMessage({ ...NOTHING, sensorIssue: 'HR lost', splitBanner: 'km 5' })
    ).toEqual({ kind: 'sensor', text: 'HR lost' });
  });

  it('gps warning beats a sensor issue and a split', () => {
    expect(
      selectStatusMessage({
        ...NOTHING,
        gpsWarning: 'weak',
        sensorIssue: 'HR lost',
        splitBanner: 'km 5',
      })
    ).toEqual({ kind: 'gps', text: 'weak' });
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
        splitBanner: 'km 5',
      })
    ).toEqual({ kind: 'background', text: 'no background tracking' });
  });

  it('treats empty strings as absent', () => {
    expect(
      selectStatusMessage({
        backgroundTrackingWarning: '',
        gpsWarning: '',
        sensorIssue: '',
        splitBanner: '',
      })
    ).toBeNull();
  });
});
