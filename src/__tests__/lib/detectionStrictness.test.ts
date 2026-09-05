import { applyDetectionStrictness } from '@/shared/native/engine';
import { engine } from 'veloqrs';

jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      setMatchStrictness: jest.fn(),
      setSectionConfig: jest.fn(),
      getSectionConfig: jest.fn(() => ({ proximityThreshold: 75, minActivities: 4 })),
    },
  })
);

describe('applyDetectionStrictness', () => {
  it('choosing a strictness keeps the sliders', () => {
    applyDetectionStrictness('strict');
    expect(engine.setMatchStrictness).toHaveBeenCalledWith(65, 180);
    expect(engine.setSectionConfig).not.toHaveBeenCalled();
    expect(engine.getSectionConfig).not.toHaveBeenCalled();
  });
});
