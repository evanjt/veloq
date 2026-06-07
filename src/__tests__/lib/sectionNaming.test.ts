import { generateSectionName } from '@/features/routes/lib/sectionNaming';

// Mock resolveIsMetric to return true (metric)
jest.mock('@/shared/app/UnitPreferenceStore', () => ({
  resolveIsMetric: jest.fn(() => true),
}));

// Mock i18n.t to interpolate keys like the real implementation
jest.mock('@/i18n', () => ({
  i18n: {
    t: jest.fn((key: string, opts?: Record<string, string>) => {
      if (key === 'sections.autoName' && opts) {
        return `${opts.sport} Section (${opts.distance})`;
      }
      return key;
    }),
  },
}));

describe('generateSectionName', () => {
  it('prefers a present name, else auto-generates by sport and distance', () => {
    const cases: [Parameters<typeof generateSectionName>[0], string][] = [
      [
        { id: 'sec1', name: 'Alpe du Zwift', sportType: 'Ride', distanceMeters: 12000 },
        'Alpe du Zwift',
      ],
      // Non-empty name wins even with zero distance.
      [{ id: 'sec4', name: 'Custom Name', sportType: 'Ride', distanceMeters: 0 }, 'Custom Name'],
      [{ id: 'sec2', sportType: 'Run', distanceMeters: 5000 }, 'Run Section (5.0 km)'],
      // Short sections use meters.
      [{ id: 'sec3', sportType: 'Ride', distanceMeters: 500 }, 'Ride Section (500 m)'],
      // Empty string is falsy, so it auto-generates.
      [{ id: 'sec5', name: '', sportType: 'Walk', distanceMeters: 2500 }, 'Walk Section (2.5 km)'],
    ];

    for (const [input, expected] of cases) {
      expect(generateSectionName(input)).toBe(expected);
    }
  });
});
