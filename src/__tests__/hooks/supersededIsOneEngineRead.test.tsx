import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useCustomSections } from '@/features/routes/hooks/useCustomSections';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: a new custom section hides the auto sections it covers. That used
 * to be worked out in JavaScript, one overlap call per auto section, each one
 * decoding a polyline and rebuilding the same R-tree.
 * Expected behaviour: the engine answers it once, and the frame is never held
 * for a loop over the library.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const AUTO_IDS = Array.from({ length: 40 }, (_, i) => `auto-${i}`);

function createdSection() {
  return {
    id: 'custom-1',
    encodedPolyline: '',
    distanceMeters: 1200,
    sportType: 'Ride',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function engine() {
  return {
    getSectionsByType: jest.fn((type: string) =>
      type === 'auto' ? AUTO_IDS.map((id) => ({ id, encodedPolyline: '', sportType: 'Ride' })) : []
    ),
    createSectionFromIndices: jest.fn(() => 'custom-1'),
    getSectionById: jest.fn(() => createdSection()),
    findSupersededSections: jest.fn(() => ['auto-3', 'auto-7']),
    setSuperseded: jest.fn(),
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function createOne(mock: ReturnType<typeof engine>) {
  mockedGetEngine.mockReturnValue(mock as never);
  const { result } = renderHook(() => useCustomSections(), { wrapper });
  await act(async () => {
    await result.current.createSection({
      startIndex: 0,
      endIndex: 10,
      sourceActivityId: 'act-1',
      sportType: 'Ride',
    });
  });
}

describe('the superseded lookup after a custom section is created', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks the engine once instead of once per auto section', async () => {
    const mock = engine();
    await createOne(mock);

    expect(mock.findSupersededSections).toHaveBeenCalledTimes(1);
  });

  /** The old loop could not measure anything without this list. */
  it('never reads the auto section list into JavaScript', async () => {
    const mock = engine();
    await createOne(mock);

    expect(mock.getSectionsByType).not.toHaveBeenCalledWith('auto');
  });

  it('supersedes exactly the sections the engine named', async () => {
    const mock = engine();
    await createOne(mock);

    expect(mock.setSuperseded.mock.calls).toEqual([
      ['auto-3', 'custom-1'],
      ['auto-7', 'custom-1'],
    ]);
  });

  it('creates the section even when the lookup throws', async () => {
    const mock = engine();
    mock.findSupersededSections.mockImplementation(() => {
      throw new Error('engine gone');
    });
    mockedGetEngine.mockReturnValue(mock as never);

    const { result } = renderHook(() => useCustomSections(), { wrapper });
    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.createSection({
        startIndex: 0,
        endIndex: 10,
        sourceActivityId: 'act-1',
        sportType: 'Ride',
      });
    });

    expect(created?.id).toBe('custom-1');
    expect(mock.setSuperseded).not.toHaveBeenCalled();
  });

  it('sets nothing when the engine names no section', async () => {
    const mock = engine();
    mock.findSupersededSections.mockReturnValue([]);
    await createOne(mock);

    expect(mock.setSuperseded).not.toHaveBeenCalled();
  });
});
