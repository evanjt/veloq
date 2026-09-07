/**
 * Scenario: the preview picker reads its ranked riding areas from the engine,
 * which ranks and names them in one call.
 * Expected behaviour: the centres are read once per mount, their names come
 * straight through, and an engine that throws leaves the screen empty rather
 * than crashing it.
 */

import { renderHook } from '@testing-library/react-native';

import { usePreviewCentres } from '@/features/routes/hooks/usePreviewCentres';
import type { PreviewCentre } from '../../../modules/veloqrs/src/delegates/preview';

function centre(over: Partial<PreviewCentre>): PreviewCentre {
  return {
    binKey: '1055:193',
    lat: 47.5,
    lng: 8.7,
    visitTotal: 40,
    sectionCount: 3,
    source: 'sections',
    locality: null,
    ...over,
  };
}

function client(centres: PreviewCentre[], getPreviewCentres = jest.fn(() => centres)) {
  return { client: { getPreviewCentres } as never, getPreviewCentres };
}

describe('usePreviewCentres', () => {
  it('labels each area with the name the engine joined for it', () => {
    const { client: c } = client([centre({ locality: 'Winterthur' })]);

    const { result } = renderHook(() => usePreviewCentres(c));

    expect(result.current.labels[0].label).toBe('Winterthur');
  });

  it('numbers an area the engine could not name', () => {
    const { client: c } = client([centre({ locality: null })]);

    const { result } = renderHook(() => usePreviewCentres(c));

    expect(result.current.labels[0].label).toBeNull();
    expect(result.current.labels[0].fallbackNumber).toBe(1);
  });

  it('reads the centres once per mount and not on every render', () => {
    const { client: c, getPreviewCentres } = client([centre({})]);

    const { rerender } = renderHook(() => usePreviewCentres(c));
    rerender(undefined);

    expect(getPreviewCentres).toHaveBeenCalledTimes(1);
  });

  it('asks for the limit it was given', () => {
    const { client: c, getPreviewCentres } = client([centre({})]);

    renderHook(() => usePreviewCentres(c, 3));

    expect(getPreviewCentres).toHaveBeenCalledWith(3);
  });

  it('leaves the screen empty when the engine throws', () => {
    const throwing = {
      getPreviewCentres: jest.fn(() => {
        throw new Error('engine down');
      }),
    } as never;

    const { result } = renderHook(() => usePreviewCentres(throwing));

    expect(result.current.centres).toEqual([]);
    expect(result.current.labels).toEqual([]);
  });

  it('leaves the screen empty when there is no client yet', () => {
    const { result } = renderHook(() => usePreviewCentres(null));

    expect(result.current.centres).toEqual([]);
    expect(result.current.labels).toEqual([]);
  });
});
