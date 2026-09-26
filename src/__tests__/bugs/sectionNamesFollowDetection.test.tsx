/**
 * Scenario: a detection run finishes, or a section is renamed, while a screen
 * showing section names is open.
 *
 * Expected behaviour: the names on screen follow. They were read once at mount
 * and never again, so a section that was given a real name kept the generated
 * one until the screen was left and re-entered.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useSectionDisplayNames } from '@/features/routes/hooks/useSectionDisplayNames';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const listeners = new Map<string, Set<() => void>>();

const engine = {
  getSectionSummaries: jest.fn(() => ({ summaries: [{ id: 's1', name: 'Old climb' }] })),
  getAllSectionNames: jest.fn(() => ({})),
  getSectionLineages: jest.fn(() => []),
  subscribe: jest.fn((channel: string, listener: () => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
    return () => listeners.get(channel)!.delete(listener);
  }),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** What the engine sends when detection lands or a section is renamed. */
function announce(channel: string): void {
  act(() => {
    for (const listener of listeners.get(channel) ?? []) listener();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  engine.getSectionSummaries.mockReturnValue({ summaries: [{ id: 's1', name: 'Old climb' }] });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

describe('section display names follow the engine', () => {
  it('re-reads when detection applies', () => {
    const { result } = renderHook(() => useSectionDisplayNames());
    expect(result.current.s1).toBe('Old climb');

    engine.getSectionSummaries.mockReturnValue({
      summaries: [{ id: 's1', name: 'Col du Pillon' }],
    });
    announce('detectionApplied');

    expect(result.current.s1).toBe('Col du Pillon');
  });

  it('re-reads when a rename announces on the sections channel', () => {
    const { result } = renderHook(() => useSectionDisplayNames());

    engine.getAllSectionNames.mockReturnValue({ s1: 'My climb' });
    announce('sections');

    expect(result.current.s1).toBe('My climb');
  });

  it('does not re-read on a render that nothing announced', () => {
    const { rerender } = renderHook(() => useSectionDisplayNames());
    const afterMount = engine.getSectionSummaries.mock.calls.length;

    for (let render = 0; render < 10; render++) rerender(undefined);

    expect(engine.getSectionSummaries.mock.calls.length).toBe(afterMount);
  });

  it('gives an empty map when the engine is not open', () => {
    mockGetEngine.mockReturnValue(null as unknown as ReturnType<typeof getEngine>);
    const { result } = renderHook(() => useSectionDisplayNames());

    expect(result.current).toEqual({});
  });
});
