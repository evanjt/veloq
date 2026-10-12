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
  subscribe: jest.fn((channel: string, listener: () => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
    return () => listeners.get(channel)!.delete(listener);
  }),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** What the engine sends when detection lands or a section is renamed. */
async function announce(channel: string): Promise<void> {
  await act(() => {
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
  it('re-reads when detection applies', async () => {
    const { result } = await renderHook(() => useSectionDisplayNames());
    expect(result.current.s1).toBe('Old climb');

    engine.getSectionSummaries.mockReturnValue({
      summaries: [{ id: 's1', name: 'Col du Pillon' }],
    });
    await announce('detectionApplied');

    expect(result.current.s1).toBe('Col du Pillon');
  });

  it('re-reads when a rename announces on the sections channel', async () => {
    const { result } = await renderHook(() => useSectionDisplayNames());

    engine.getSectionSummaries.mockReturnValue({ summaries: [{ id: 's1', name: 'My climb' }] });
    await announce('sections');

    expect(result.current.s1).toBe('My climb');
  });

  it('does not re-read on a render that nothing announced', async () => {
    const { rerender } = await renderHook(() => useSectionDisplayNames());
    const afterMount = engine.getSectionSummaries.mock.calls.length;

    for (let render = 0; render < 10; render++) await rerender(undefined);

    expect(engine.getSectionSummaries.mock.calls.length).toBe(afterMount);
  });

  it('gives an empty map when the engine is not open', async () => {
    mockGetEngine.mockReturnValue(null as unknown as ReturnType<typeof getEngine>);
    const { result } = await renderHook(() => useSectionDisplayNames());

    expect(result.current).toEqual({});
  });
});
