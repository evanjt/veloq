import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useCustomSections } from '@/features/routes/hooks/useCustomSections';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: creating a custom section hides the auto sections it covers.
 * Expected behaviour: one engine mutation commits both the section and the
 * coverage decision, and a failed mutation leaves no partial result in JS.
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
    sportTypes: ['Ride'],
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function engine() {
  return {
    getSectionsByType: jest.fn((type: string) =>
      type === 'auto'
        ? AUTO_IDS.map((id) => ({ id, encodedPolyline: '', sportTypes: ['Ride'] }))
        : []
    ),
    createSectionFromIndices: jest.fn(() => 'custom-1'),
    getSectionById: jest.fn(() => createdSection()),
    // The hook listens for the engine's own `sections` announcement, so the
    // stub has to offer the channel the real engine does.
    subscribe: jest.fn(() => jest.fn()),
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

  it('makes one engine mutation without a follow-up supersession read', async () => {
    const mock = engine();
    await createOne(mock);

    expect(mock.createSectionFromIndices).toHaveBeenCalledTimes(1);
  });

  it('never reads the auto section list into JavaScript', async () => {
    const mock = engine();
    await createOne(mock);

    expect(mock.getSectionsByType).not.toHaveBeenCalledWith('auto');
  });

  it('propagates a failed atomic creation without reading a partial section', async () => {
    const mock = engine();
    mock.createSectionFromIndices.mockImplementation(() => {
      throw new Error('create rolled back');
    });
    mockedGetEngine.mockReturnValue(mock as never);

    const { result } = renderHook(() => useCustomSections(), { wrapper });
    await act(async () => {
      await expect(
        result.current.createSection({
          startIndex: 0,
          endIndex: 10,
          sourceActivityId: 'act-1',
          sportType: 'Ride',
        })
      ).rejects.toThrow('create rolled back');
    });

    expect(mock.getSectionById).not.toHaveBeenCalled();
  });

  it('makes one mutation on each call, including the second', async () => {
    const mock = engine();
    mockedGetEngine.mockReturnValue(mock as never);
    const { result } = renderHook(() => useCustomSections(), { wrapper });
    await act(async () => {
      await result.current.createSection({
        startIndex: 0,
        endIndex: 10,
        sourceActivityId: 'act-1',
        sportType: 'Ride',
      });
      await result.current.createSection({
        startIndex: 11,
        endIndex: 20,
        sourceActivityId: 'act-1',
        sportType: 'Ride',
      });
    });

    expect(mock.createSectionFromIndices).toHaveBeenCalledTimes(2);
  });
});
