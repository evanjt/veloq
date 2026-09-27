/**
 * Scenario: the sections page was read after the mount interactions, so frame
 * one had no page at all. The list filled the gap from a summary read and every
 * mounted row then fetched its own polyline, 8 to 20 synchronous reads for a
 * page the engine answers in about a millisecond.
 *
 * Expected behaviour: the first page is read while rendering, so there is no gap
 * to fill, and a row draws the polyline its page carries without a read of its
 * own.
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react-native';

import { useRoutesScreenData } from '@/features/routes/hooks/useRoutesScreenData';
import { SectionRow } from '@/features/routes/components/SectionRow';
import { useSections } from '@/features/routes/hooks/useSections';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection, Section } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ sections: [], isLoading: false, error: null }),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const PAGE = {
  groups: [],
  sections: [],
  hasMoreGroups: false,
  hasMoreSections: false,
  groupCount: 0,
  sectionCount: 0,
};

function engine(overrides: Record<string, unknown> = {}) {
  return {
    getRoutesScreenData: jest.fn(() => PAGE),
    getSectionPolyline: jest.fn(() => ''),
    ...overrides,
  } as never;
}

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: 'sec-1',
    name: 'Church Hill',
    type: 'Ride',
    distance: 3200,
    polyline: [
      { lat: 45.0, lng: 10.0 },
      { lat: 45.01, lng: 10.01 },
    ],
    visitCount: 4,
    ...overrides,
  } as Section;
}

beforeEach(() => jest.clearAllMocks());

describe('the routes page', () => {
  it('is there on the first render, with no interaction to wait for', () => {
    const stub = engine();
    mockedGetEngine.mockReturnValue(stub);

    const { result } = renderHook(() => useRoutesScreenData());

    expect(result.current.data).not.toBeNull();
    expect(
      (stub as unknown as { getRoutesScreenData: jest.Mock }).getRoutesScreenData
    ).toHaveBeenCalledTimes(1);
  });
});

describe('a section row', () => {
  it('draws the polyline its page carries and reads nothing itself', () => {
    const stub = engine();
    mockedGetEngine.mockReturnValue(stub);

    render(<SectionRow section={section()} />);

    expect(
      (stub as unknown as { getSectionPolyline: jest.Mock }).getSectionPolyline
    ).not.toHaveBeenCalled();
  });

  it('reads nothing for a row whose page carried no polyline either', () => {
    const stub = engine();
    mockedGetEngine.mockReturnValue(stub);

    render(<SectionRow section={section({ polyline: [] })} />);

    expect(
      (stub as unknown as { getSectionPolyline: jest.Mock }).getSectionPolyline
    ).not.toHaveBeenCalled();
  });
});

describe('the sections hook', () => {
  it('reads nothing from the engine when the page has not landed', () => {
    mockedGetEngine.mockReturnValue(engine());

    const { result } = renderHook(() => useSections({ preloadedEngineSections: undefined }));

    expect(mockedGetEngine).not.toHaveBeenCalled();
    expect(result.current.sections).toEqual([]);
  });

  it('takes the engine rows from the page and reads nothing of its own', () => {
    mockedGetEngine.mockReturnValue(engine());
    const row = { id: 'sec-7', name: 'Col de la Page', sportType: 'Ride' } as FrequentSection;

    const { result } = renderHook(() => useSections({ preloadedEngineSections: [row] }));

    expect(mockedGetEngine).not.toHaveBeenCalled();
    expect(result.current.sections.map((s) => s.id)).toEqual(['sec-7']);
  });
});
