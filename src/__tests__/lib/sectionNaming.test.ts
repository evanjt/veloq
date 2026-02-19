import { generateSectionName } from '@/lib/utils/sectionNaming';

// Mock resolveIsMetric to return true (metric)
jest.mock('@/providers', () => ({
  resolveIsMetric: jest.fn(() => true),
}));

describe('generateSectionName', () => {
  it('returns section.name when present', () => {
    const result = generateSectionName({
      id: 'sec1',
      name: 'Alpe du Zwift',
      sportType: 'Ride',
      distanceMeters: 12000,
    });
    expect(result).toBe('Alpe du Zwift');
  });

  it('auto-generates from sport type and distance for unnamed sections', () => {
    const result = generateSectionName({
      id: 'sec2',
      sportType: 'Run',
      distanceMeters: 5000,
    });
    expect(result).toBe('Run Section (5.0 km)');
  });

  it('uses meters for short sections', () => {
    const result = generateSectionName({
      id: 'sec3',
      sportType: 'Ride',
      distanceMeters: 500,
    });
    expect(result).toBe('Ride Section (500 m)');
  });

  it('prefers name over auto-generation', () => {
    const result = generateSectionName({
      id: 'sec4',
      name: 'Custom Name',
      sportType: 'Ride',
      distanceMeters: 0,
    });
    expect(result).toBe('Custom Name');
  });

  it('handles empty name by auto-generating', () => {
    const result = generateSectionName({
      id: 'sec5',
      name: '',
      sportType: 'Walk',
      distanceMeters: 2500,
    });
    // Empty string is falsy, so auto-generates
    expect(result).toBe('Walk Section (2.5 km)');
  });
});
