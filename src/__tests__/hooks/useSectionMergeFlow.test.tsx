/**
 * Scenario: the section screen's merge button opens the candidates sheet when the section has
 * several candidates, the confirmation sheet for the chosen one, and merges on its answer.
 *
 * Expected behaviour: a selected pair runs the merge once and moves to the surviving section; a
 * dismissal at either sheet merges nothing and the confirmation never opens after a dismissed
 * candidates sheet; a single candidate goes straight to the confirmation.
 */
import { act, renderHook } from '@testing-library/react-native';
import type { MergeCandidate } from 'veloqrs';

import { useSectionMergeFlow } from '@/features/routes/hooks/useSectionMergeFlow';
import { answerSheet } from '../__shared__/answerSheet';
import type { FrequentSection } from '@/types';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockParams: { request?: string } = {};
const mockMerge = jest.fn();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    canGoBack: () => true,
    back: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/routes/hooks/useMergeSections', () => ({
  useMergeSections: () => ({ merge: mockMerge, previewDropped: () => [] }),
}));

const SECTION = {
  id: 'sec-a',
  name: 'Main Climb',
  sportTypes: ['Ride'],
  visitCount: 5,
  distanceMeters: 600,
} as FrequentSection;

const candidate = (id: string, visitCount: number) =>
  ({
    sectionId: id,
    name: `Climb ${id}`,
    sportTypes: ['Ride'],
    visitCount,
    distanceMeters: 650,
    overlapPct: 0.8,
    centerDistanceMeters: 30,
  }) as MergeCandidate;

const TWO = [candidate('sec-b', 2), candidate('sec-c', 9)];

const pushedPaths = () => mockPush.mock.calls.map(([target]) => target.pathname);

function mount(candidates: MergeCandidate[]) {
  return renderHook(() => useSectionMergeFlow({ section: SECTION, candidates }));
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockMerge.mockReset();
});

describe('the section merge flow', () => {
  it('merges the chosen pair once and moves to the surviving section', async () => {
    mockMerge.mockReturnValue('sec-c');
    const flow = await mount(TWO);
    await act(() => void flow.result.current());
    expect(pushedPaths()).toEqual(['sheets/merge-candidates']);

    await answerSheet(mockPush, mockParams, TWO[1]);
    await act(async () => {});
    expect(pushedPaths()).toEqual(['sheets/merge-candidates', 'sheets/merge-confirm']);

    await answerSheet(mockPush, mockParams, { primaryId: 'sec-a', secondaryId: 'sec-c' });
    await act(async () => {});
    expect(mockMerge).toHaveBeenCalledTimes(1);
    expect(mockMerge).toHaveBeenCalledWith('sec-a', 'sec-c');
    expect(mockReplace).toHaveBeenCalledWith('/section/sec-c');
  });

  it('stays on the section when it survives the merge', async () => {
    mockMerge.mockReturnValue('sec-a');
    const flow = await mount([TWO[0]]);
    await act(() => void flow.result.current());
    await answerSheet(mockPush, mockParams, { primaryId: 'sec-a', secondaryId: 'sec-b' });
    await act(async () => {});
    expect(mockMerge).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('skips the candidates sheet for a single candidate', async () => {
    const flow = await mount([TWO[0]]);
    await act(() => void flow.result.current());
    expect(pushedPaths()).toEqual(['sheets/merge-confirm']);
    expect(mockPush.mock.calls[0][0].params.request).toBeTruthy();
  });

  it('opens nothing and merges nothing when the candidates sheet is dismissed', async () => {
    const flow = await mount(TWO);
    await act(() => void flow.result.current());
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(pushedPaths()).toEqual(['sheets/merge-candidates']);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it('merges nothing when the confirmation sheet is dismissed', async () => {
    const flow = await mount(TWO);
    await act(() => void flow.result.current());
    await answerSheet(mockPush, mockParams, TWO[0]);
    await act(async () => {});
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('opens nothing when there is no candidate', async () => {
    const flow = await mount([]);
    await act(() => void flow.result.current());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('hands the confirmation both sections', async () => {
    const flow = await mount(TWO);
    await act(() => void flow.result.current());
    await answerSheet(mockPush, mockParams, TWO[1]);
    await act(async () => {});
    const { useSheetRequest } = jest.requireActual('@/shared/app/sheetRequest');
    mockParams.request = mockPush.mock.calls.at(-1)[0].params.request;
    const reader = await renderHook(() => useSheetRequest());
    expect(reader.result.current.input).toEqual({
      primary: {
        id: 'sec-a',
        name: 'Main Climb',
        sportTypes: ['Ride'],
        visitCount: 5,
        distanceMeters: 600,
      },
      secondary: {
        id: 'sec-c',
        name: 'Climb sec-c',
        sportTypes: ['Ride'],
        visitCount: 9,
        distanceMeters: 650,
      },
    });
    await reader.unmount();
  });
});
