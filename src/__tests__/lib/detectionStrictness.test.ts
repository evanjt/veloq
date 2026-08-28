import { applyDetectionStrictness } from '@/shared/native/routeEngine';
import { routeEngine } from 'veloqrs';

jest.mock('veloqrs', () => ({
  routeEngine: {
    setMatchStrictness: jest.fn(),
    setSectionConfig: jest.fn(),
    getSectionConfig: jest.fn(() => ({ proximityThreshold: 75, minActivities: 4 })),
  },
}));

describe('applyDetectionStrictness', () => {
  it('choosing a strictness keeps the sliders', () => {
    applyDetectionStrictness('strict');
    expect(routeEngine.setMatchStrictness).toHaveBeenCalledWith(65, 180);
    expect(routeEngine.setSectionConfig).not.toHaveBeenCalled();
    expect(routeEngine.getSectionConfig).not.toHaveBeenCalled();
  });
});
