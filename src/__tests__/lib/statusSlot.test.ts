import { selectStatusMessage } from '@/features/recording/lib/statusSlot';

describe('selectStatusMessage', () => {
  it('returns null when nothing is active', () => {
    expect(
      selectStatusMessage({ gpsWarning: null, sensorIssue: null, splitBanner: null })
    ).toBeNull();
  });

  it('shows a lone split toast', () => {
    expect(
      selectStatusMessage({ gpsWarning: null, sensorIssue: null, splitBanner: 'km 5' })
    ).toEqual({ kind: 'split', text: 'km 5' });
  });

  it('sensor issue beats split toast', () => {
    expect(
      selectStatusMessage({ gpsWarning: null, sensorIssue: 'HR lost', splitBanner: 'km 5' })
    ).toEqual({ kind: 'sensor', text: 'HR lost' });
  });

  it('gps warning beats everything', () => {
    expect(
      selectStatusMessage({ gpsWarning: 'weak', sensorIssue: 'HR lost', splitBanner: 'km 5' })
    ).toEqual({ kind: 'gps', text: 'weak' });
  });

  it('treats empty strings as absent', () => {
    expect(selectStatusMessage({ gpsWarning: '', sensorIssue: '', splitBanner: '' })).toBeNull();
  });
});
