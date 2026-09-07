/**
 * Scenario: the preview picker names each riding area from the activities on
 * the device. A riding area last used years ago is still a riding area, so the
 * name has to come from everything stored rather than from a synced window.
 * Expected behaviour: the join reads stored bodies over all of history, asks
 * for no sync of its own, and reports what it saw so a centre that falls back
 * to a number says why.
 */

import { renderHook } from '@testing-library/react-native';

import { usePreviewCentres } from '@/features/routes/hooks/usePreviewCentres';
import { getEngine } from '@/shared/native/engine';
import type { PreviewCentre } from '../../../modules/veloqrs/src/delegates/preview';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getActivityBodies: jest.fn(),
  syncActivitiesWindow: jest.fn(),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const CENTRE: PreviewCentre = {
  binKey: '1055:193',
  lat: 47.5,
  lng: 8.7,
  visitTotal: 40,
  sectionCount: 3,
  source: 'sections',
};

function client(centres: PreviewCentre[]) {
  return { getPreviewCentres: jest.fn(() => centres) } as never;
}

function body(over: Record<string, unknown>): string {
  return JSON.stringify({ id: 'a1', ...over });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getActivityBodies.mockReturnValue([]);
  engine.syncActivitiesWindow.mockReturnValue(true);
});

describe('usePreviewCentres', () => {
  it('names an area whose only nearby activity is two years old', () => {
    const twoYearsAgo = Math.floor(Date.now() / 1000) - 730 * 86400;
    engine.getActivityBodies.mockReturnValue([
      body({ locality: 'Winterthur', start_latlng: [47.5, 8.7], start_date_local: twoYearsAgo }),
    ]);

    const { result } = renderHook(() => usePreviewCentres(client([CENTRE])));

    expect(result.current.labels[0].label).toBe('Winterthur');
  });

  it('reads stored bodies over all of history and requests no sync window', () => {
    renderHook(() => usePreviewCentres(client([CENTRE])));

    expect(engine.getActivityBodies).toHaveBeenCalled();
    const [oldest, newest] = engine.getActivityBodies.mock.calls[0];
    expect(Number(oldest)).toBe(0);
    expect(Number(newest)).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000));
    expect(engine.syncActivitiesWindow).not.toHaveBeenCalled();
  });

  it('reports what the join saw for a centre that fell back to a number', () => {
    engine.getActivityBodies.mockReturnValue([
      body({ locality: 'Faraway', start_latlng: [0, 0] }),
      body({ start_latlng: [47.5, 8.7] }),
      body({ locality: 'Nowhere' }),
    ]);

    const { result } = renderHook(() => usePreviewCentres(client([CENTRE])));

    const [label] = result.current.labels;
    expect(label.label).toBeNull();
    expect(label.fallbackNumber).toBe(1);
    expect(label.join.seen).toBe(3);
    expect(label.join.withLocality).toBe(2);
    expect(label.join.withPosition).toBe(2);
    expect(label.join.nearestMetres).toBeGreaterThanOrEqual(0);
    expect(label.join.nearestMetres).toBeLessThan(5000);
  });

  it('leaves the nearest distance unknown when no activity carries a position', () => {
    engine.getActivityBodies.mockReturnValue([body({ locality: 'Nowhere' })]);

    const { result } = renderHook(() => usePreviewCentres(client([CENTRE])));

    expect(result.current.labels[0].join.nearestMetres).toBeNull();
  });

  it('skips a body that will not parse rather than losing the whole join', () => {
    engine.getActivityBodies.mockReturnValue([
      '{broken',
      body({ locality: 'Winterthur', start_latlng: [47.5, 8.7] }),
    ]);

    const { result } = renderHook(() => usePreviewCentres(client([CENTRE])));

    expect(result.current.labels[0].label).toBe('Winterthur');
    expect(result.current.labels[0].join.seen).toBe(1);
  });

  it('gives an engine that is not up yet an empty join rather than a throw', () => {
    mockGetEngine.mockReturnValue(null as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => usePreviewCentres(client([CENTRE])));

    expect(result.current.labels[0].label).toBeNull();
    expect(result.current.labels[0].join.seen).toBe(0);
  });
});
