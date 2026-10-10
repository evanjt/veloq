import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionTrim } from '@/features/routes/hooks/useSectionTrim';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';
import { encodeTrack } from '../__shared__/trackBytes';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: jest.requireActual('../../../modules/veloqrs/src/coords').decodeCoords,
  })
);
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// Scenario: the stored line is a 200-point consensus line, while the
// representative track matches it over a 100-point span, so track offsets
// are not stored-line indices.
// Expected behaviour: a shrink in expand mode addresses the representative
// track, never the stored line.
const TRACK_START = 100;
const TRACK_END = 199;
const track = Array.from({ length: 300 }, (_, i) => ({ latitude: 46 + i * 0.0001, longitude: 7 }));
const polyline = Array.from({ length: 200 }, (_, i) => ({ lat: 46.01 + i * 0.00005, lng: 7 }));
const section = {
  id: 'hill',
  polyline,
  distanceMeters: 1100,
  representativeActivityId: 'rep',
} as unknown as FrequentSection;

function expandedHook(target: FrequentSection = section) {
  const engine = {
    getSectionExtensionTrack: jest.fn(() => ({
      encodedTrack: encodeTrack(track),
      sectionStartIdx: TRACK_START,
      sectionEndIdx: TRACK_END,
    })),
    runSectionBoundsEdit: jest.fn(() => Promise.resolve([])),
  };
  (getEngine as jest.Mock).mockReturnValue(engine);
  const hook = renderHook(() => useSectionTrim(target, jest.fn(), true));
  act(() => hook.result.current.startTrim());
  act(() => hook.result.current.toggleExpand());
  return { hook, engine };
}

describe('useSectionTrim shrink in expand mode', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends track indices on the representative activity when both handles move in', async () => {
    const { hook, engine } = expandedHook();
    const inWindowStart = hook.result.current.sectionStartInWindow!;
    const inWindowEnd = hook.result.current.sectionEndInWindow!;
    expect(inWindowEnd - inWindowStart).toBe(TRACK_END - TRACK_START);

    act(() => hook.result.current.setTrimStart(inWindowStart + 10));
    act(() => hook.result.current.setTrimEnd(inWindowEnd - 10));
    await act(() => hook.result.current.confirmTrim());

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({
      kind: 'expand',
      sectionId: 'hill',
      activityId: 'rep',
      startIndex: TRACK_START + 10,
      endIndex: TRACK_END - 10,
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('sends track indices when only the end handle moves in', async () => {
    const { hook, engine } = expandedHook();
    const inWindowEnd = hook.result.current.sectionEndInWindow!;

    act(() => hook.result.current.setTrimEnd(inWindowEnd - 9));
    await act(() => hook.result.current.confirmTrim());

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({
      kind: 'expand',
      sectionId: 'hill',
      activityId: 'rep',
      startIndex: TRACK_START,
      endIndex: TRACK_END - 9,
    });
  });

  it('refuses the shrink and sends nothing when the section has no representative', async () => {
    const unowned = { ...section, representativeActivityId: undefined } as FrequentSection;
    const { hook, engine } = expandedHook(unowned);
    const inWindowStart = hook.result.current.sectionStartInWindow!;

    act(() => hook.result.current.setTrimStart(inWindowStart + 10));
    await act(() => hook.result.current.confirmTrim());

    expect(engine.runSectionBoundsEdit).not.toHaveBeenCalled();
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toBe('sections.trimFailed');
  });
});
