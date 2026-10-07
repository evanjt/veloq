import { act, renderHook } from '@testing-library/react-native';
import { StartOutcome } from 'veloqrs';

import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: () => {},
}));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ removeSection: jest.fn(), renameSection: jest.fn() }),
}));

let mockHold: string | null = null;
jest.mock('@/features/routes/hooks/useDetectionHold', () => ({
  useDetectionHold: () => mockHold,
}));

const mockEngine = {
  startSectionDetection: jest.fn(() => StartOutcome.Held),
  getSectionCount: jest.fn(() => 3),
  getSectionDetectionProgress: jest.fn(() => null),
};
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

const section: FrequentSection = {
  id: 's1',
  sectionType: 'custom',
  sportTypes: ['Ride'],
  name: 'Ridge loop',
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

const noExclusions: string[] = [];

function mount() {
  return renderHook(() =>
    useSectionActions({
      id: section.id,
      isCustomId: true,
      section,
      isSectionDisabled: false,
      onSectionRefresh: jest.fn(),
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: noExclusions,
    })
  );
}

describe('the section detail rematch', () => {
  beforeEach(() => {
    mockHold = null;
    mockEngine.startSectionDetection.mockReturnValue(StartOutcome.Held);
  });

  it('exposes the refusal the engine answered, and drops it on the next start', () => {
    const { result } = mount();
    expect(result.current.rescanRefusal).toBeNull();

    act(() => result.current.handleRematchActivities());
    expect(result.current.rescanRefusal).toBe(StartOutcome.Held);

    mockEngine.startSectionDetection.mockReturnValue(StartOutcome.Started);
    act(() => result.current.handleRematchActivities());
    expect(result.current.rescanRefusal).toBeNull();
  });

  it('holds the button while detection is held', () => {
    mockHold = 'cutover';
    expect(mount().result.current.isRematchHeld).toBe(true);
    mockHold = null;
    expect(mount().result.current.isRematchHeld).toBe(false);
  });
});
