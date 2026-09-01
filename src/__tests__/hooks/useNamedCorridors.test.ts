/**
 * Scenario: the corridor listing behind the names a user typed.
 * Expected behaviour: every intent the engine holds is listed, dormant ones
 * included, and a delete removes exactly the intent that was asked for.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useNamedCorridors } from '@/features/routes/hooks/useNamedCorridors';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

// Real decoder, native binding stubbed out: the footprint bytes are the point.
jest.mock('veloqrs', () => ({
  decodeCoords: jest.requireActual('../../../modules/veloqrs/src/coords').decodeCoords,
}));

function encodeCoords(points: { latitude: number; longitude: number }[]): ArrayBuffer {
  const bytes: number[] = [];
  const varint = (value: number) => {
    let v = value;
    while (v > 0x7f) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v);
  };
  const zigzag = (v: number) => varint(((v << 1) ^ (v >> 31)) >>> 0);
  varint(points.length);
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    const la = Math.round(p.latitude * 1e7);
    const ln = Math.round(p.longitude * 1e7);
    zigzag(la - lat);
    zigzag(ln - lng);
    lat = la;
    lng = ln;
  }
  return new Uint8Array(bytes).buffer;
}

const FOOTPRINT = encodeCoords([
  { latitude: 46.5, longitude: 7.1 },
  { latitude: 46.6, longitude: 7.2 },
]);

function corridor(over: Record<string, unknown> = {}) {
  return {
    intentId: 'intent-1',
    name: 'The river climb',
    encodedFootprint: FOOTPRINT,
    sportType: 'Ride',
    createdAt: '2026-08-01 09:00:00',
    sectionId: 'sec-1',
    coverage: 0.82,
    primary: true,
    ...over,
  };
}

function engineWith(rows: ReturnType<typeof corridor>[]) {
  const state = { rows };
  return {
    state,
    getNamedCorridors: jest.fn(() => state.rows),
    removeNamedCorridor: jest.fn((intentId: string) => {
      state.rows = state.rows.filter((r) => r.intentId !== intentId);
      return true;
    }),
    subscribe: jest.fn((_event: string, _cb: () => void) => () => {}),
  };
}

describe('useNamedCorridors', () => {
  it('is empty when the user has named nothing', () => {
    const engine = engineWith([]);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = renderHook(() => useNamedCorridors());
    expect(result.current.corridors).toEqual([]);
  });

  it('is empty and refuses a delete without an engine', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useNamedCorridors());
    expect(result.current.corridors).toEqual([]);
    expect(result.current.remove('intent-1')).toBe(false);
  });

  it('decodes one corridor footprint and carries its resolution through', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith([corridor()]));
    const { result } = renderHook(() => useNamedCorridors());

    expect(result.current.corridors).toHaveLength(1);
    const only = result.current.corridors[0];
    expect(only.name).toBe('The river climb');
    expect(only.sectionId).toBe('sec-1');
    expect(only.dormant).toBe(false);
    expect(only.footprint).toHaveLength(2);
    expect(only.footprint[0].latitude).toBeCloseTo(46.5, 6);
    expect(only.footprint[1].longitude).toBeCloseTo(7.2, 6);
  });

  it('marks a corridor dormant when no visible section carries its name', () => {
    (getEngine as jest.Mock).mockReturnValue(
      engineWith([corridor({ sectionId: undefined, coverage: 0, primary: false })])
    );
    const { result } = renderHook(() => useNamedCorridors());
    expect(result.current.corridors[0].dormant).toBe(true);
  });

  it('keeps both intents when a second name lands on the same ground', () => {
    (getEngine as jest.Mock).mockReturnValue(
      engineWith([
        corridor(),
        corridor({ intentId: 'intent-2', name: 'The river climb', primary: false }),
      ])
    );
    const { result } = renderHook(() => useNamedCorridors());

    expect(result.current.corridors.map((c) => c.intentId)).toEqual(['intent-1', 'intent-2']);
    expect(result.current.corridors.map((c) => c.primary)).toEqual([true, false]);
  });

  it('deletes only the named intent and re-reads, and a second delete is a no-op', () => {
    const engine = engineWith([corridor(), corridor({ intentId: 'intent-2', name: 'Back lane' })]);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = renderHook(() => useNamedCorridors());

    act(() => {
      expect(result.current.remove('intent-1')).toBe(true);
    });
    expect(engine.removeNamedCorridor).toHaveBeenCalledWith('intent-1');
    expect(result.current.corridors.map((c) => c.intentId)).toEqual(['intent-2']);

    act(() => {
      result.current.remove('intent-1');
    });
    expect(result.current.corridors.map((c) => c.intentId)).toEqual(['intent-2']);
  });

  it('shows a name given again after a delete', () => {
    const engine = engineWith([corridor()]);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = renderHook(() => useNamedCorridors());

    act(() => {
      result.current.remove('intent-1');
    });
    expect(result.current.corridors).toEqual([]);

    engine.state.rows = [corridor({ intentId: 'intent-9' })];
    act(() => {
      engine.subscribe.mock.calls[0][1]();
    });
    expect(result.current.corridors.map((c) => c.intentId)).toEqual(['intent-9']);
  });

  it('reports a failed delete instead of dropping the row', () => {
    const engine = engineWith([corridor()]);
    engine.removeNamedCorridor.mockReturnValue(false);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = renderHook(() => useNamedCorridors());

    act(() => {
      expect(result.current.remove('intent-1')).toBe(false);
    });
    expect(result.current.corridors).toHaveLength(1);
  });
});
