/**
 * Scenario: the preview picker reads its ranked riding areas from the engine,
 * which ranks and names them in one call.
 * Expected behaviour: the centres are read once per mount, their names come
 * straight through, and an engine that throws hands the error back so the
 * picker can say the read failed.
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
    ...over,
  };
}

function client(centres: PreviewCentre[], getPreviewCentres = jest.fn(() => centres)) {
  return { client: { getPreviewCentres } as never, getPreviewCentres };
}

describe('usePreviewCentres', () => {
  it('letters each area', async () => {
    const { client: c } = client([centre({})]);

    const { result } = await renderHook(() => usePreviewCentres(c));

    expect(result.current.labels[0].fallbackLetter).toBe('A');
  });

  it('reads the centres once per mount and not on every render', async () => {
    const { client: c, getPreviewCentres } = client([centre({})]);

    const { rerender } = await renderHook(() => usePreviewCentres(c));
    await rerender(undefined);

    expect(getPreviewCentres).toHaveBeenCalledTimes(1);
  });

  it('asks for the limit it was given', async () => {
    const { client: c, getPreviewCentres } = client([centre({})]);

    await renderHook(() => usePreviewCentres(c, 3));

    expect(getPreviewCentres).toHaveBeenCalledWith(3);
  });

  it('hands the thrown error back beside empty centres', async () => {
    const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };
    const throwing = {
      getPreviewCentres: jest.fn(() => {
        throw lockFailed;
      }),
    } as never;

    const { result } = await renderHook(() => usePreviewCentres(throwing));

    expect(result.current.error).toBe(lockFailed);
    expect(result.current.centres).toEqual([]);
    expect(result.current.labels).toEqual([]);
  });

  it('carries no error when the read succeeds', async () => {
    const { client: c } = client([centre({})]);

    const { result } = await renderHook(() => usePreviewCentres(c));

    expect(result.current.error).toBeUndefined();
  });

  it('leaves the screen empty when there is no client yet', async () => {
    const { result } = await renderHook(() => usePreviewCentres(null));

    expect(result.current.centres).toEqual([]);
    expect(result.current.labels).toEqual([]);
  });
});
