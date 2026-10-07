import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useCustomSections } from '@/features/routes/hooks/useCustomSections';
import type { CreateSectionParams } from '@/features/routes/hooks/useCustomSections';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: a custom section is created with no name, an explicit name, or a
 * blank one.
 * Expected behaviour: the engine receives the explicit name unchanged and no
 * name otherwise, so the section is shown under the number the engine gives
 * it. It never receives an empty string or a generated name.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function engine() {
  return {
    getSectionsByType: jest.fn(() => []),
    createSectionFromIndices: jest.fn((..._args: unknown[]) => 'custom-1'),
    getSectionById: jest.fn(() => ({
      id: 'custom-1',
      encodedPolyline: '',
      distanceMeters: 1200,
      sportTypes: ['Ride'],
      createdAt: '2026-01-01T00:00:00Z',
    })),
    subscribe: jest.fn(() => jest.fn()),
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function nameSentToEngine(name?: string): Promise<unknown> {
  const mock = engine();
  mockedGetEngine.mockReturnValue(mock as never);
  const { result } = renderHook(() => useCustomSections(), { wrapper });
  const params: CreateSectionParams = {
    startIndex: 0,
    endIndex: 10,
    sourceActivityId: 'act-1',
    sportType: 'Ride',
    ...(name === undefined ? {} : { name }),
  };
  await act(async () => {
    await result.current.createSection(params);
  });
  return mock.createSectionFromIndices.mock.calls[0][4];
}

describe('the name a custom section is created with', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is no name when none is given', async () => {
    expect(await nameSentToEngine()).toBeUndefined();
  });

  it('is the explicit name, unchanged', async () => {
    expect(await nameSentToEngine('Hill repeats')).toBe('Hill repeats');
  });

  it.each(['', '   '])('is no name for the blank name %j', async (blank) => {
    expect(await nameSentToEngine(blank)).toBeUndefined();
  });
});
