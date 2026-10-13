import {
  ALL_DATA_FIELDS,
  MAX_DATA_FIELDS,
  defaultDataFields,
  fieldsForMode,
} from '@/features/recording/lib/dataFields';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

describe('defaultDataFields', () => {
  it.each(['Run', 'TrailRun', 'Walk', 'Hike'] as const)('gives %s pace and no power', (sport) => {
    const fields = defaultDataFields(sport);
    expect(fields).toContain('pace');
    expect(fields).not.toContain('speed');
    expect(fields).not.toContain('power');
    expect(fields).toEqual(['pace', 'distance', 'heartrate', 'movingTime']);
  });

  it('keeps speed and power for a ride', () => {
    expect(defaultDataFields('Ride')).toEqual(['speed', 'distance', 'heartrate', 'power']);
  });

  it('drops power for an outdoor sport that does not measure it', () => {
    const fields = defaultDataFields('NordicSki');
    expect(fields).toContain('speed');
    expect(fields).not.toContain('power');
  });

  it('gives an indoor run pace in place of power', () => {
    const fields = defaultDataFields('Treadmill');
    expect(fields).toContain('pace');
    expect(fields).not.toContain('power');
    expect(defaultDataFields('VirtualRide')).toContain('power');
  });

  it('never exceeds the cap', () => {
    for (const sport of ['Ride', 'Run', 'Swim', 'Yoga', 'VirtualRow'] as const) {
      expect(defaultDataFields(sport).length).toBeLessThanOrEqual(MAX_DATA_FIELDS);
    }
  });
});

describe('fieldsForMode', () => {
  it('falls back to the sport default when nothing is stored', () => {
    expect(fieldsForMode({}, 'gps', 'Run')).toEqual(defaultDataFields('Run'));
  });

  it('prefers the stored layout over the sport default', () => {
    expect(fieldsForMode({ gps: ['speed'] }, 'gps', 'Run')).toEqual(['speed']);
  });

  it('trims a stored layout past the cap', () => {
    expect(fieldsForMode({ gps: ALL_DATA_FIELDS }, 'gps', 'Ride')).toEqual(
      ALL_DATA_FIELDS.slice(0, MAX_DATA_FIELDS)
    );
  });
});

describe('the field cap', () => {
  it('is even, so the half-width tiles fill whole rows', () => {
    expect(MAX_DATA_FIELDS % 2).toBe(0);
    expect(MAX_DATA_FIELDS).toBeLessThan(ALL_DATA_FIELDS.length);
  });

  it('stores at most the cap when every field is set', () => {
    useRecordingPreferences.getState().setDataFields('gps', [...ALL_DATA_FIELDS]);
    expect(useRecordingPreferences.getState().dataFields.gps).toEqual(
      ALL_DATA_FIELDS.slice(0, MAX_DATA_FIELDS)
    );
  });

  it('edits a run tile from the run default rather than the ride one', () => {
    useRecordingPreferences.setState({ dataFields: {} });
    useRecordingPreferences.getState().setSlotField('gps', 3, 'cadence', 'Run');
    expect(useRecordingPreferences.getState().dataFields.gps).toEqual([
      'pace',
      'distance',
      'heartrate',
      'cadence',
    ]);
  });
});

describe('a layout stored before defaults followed the sport', () => {
  it('gives way to the sport default when it matches the old default', async () => {
    const { getSetting } = jest.requireMock('@/shared/storage');
    getSetting.mockResolvedValueOnce(
      JSON.stringify({
        dataFields: {
          gps: ['speed', 'distance', 'heartrate', 'power'],
          indoor: ['heartrate', 'calories'],
        },
      })
    );
    await useRecordingPreferences.getState().initialise();
    const { dataFields } = useRecordingPreferences.getState();
    expect(fieldsForMode(dataFields, 'gps', 'Run')).toEqual(defaultDataFields('Run'));
    expect(dataFields.indoor).toEqual(['heartrate', 'calories']);
  });
});
