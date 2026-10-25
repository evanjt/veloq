import { terrainReportScript } from '@/features/maps/lib/htmlBuilders/shared';

type Handler = (event: Record<string, unknown>) => void;

function fakeMap() {
  const handlers: Record<string, Handler[]> = {};
  return {
    on(name: string, fn: Handler) {
      (handlers[name] ||= []).push(fn);
    },
    once(name: string, fn: Handler) {
      const wrapper: Handler = (event) => {
        handlers[name] = (handlers[name] || []).filter((h) => h !== wrapper);
        fn(event);
      };
      (handlers[name] ||= []).push(wrapper);
    },
    emit(name: string, event: Record<string, unknown> = {}) {
      [...(handlers[name] || [])].forEach((h) => h(event));
    },
  };
}

function loadReport() {
  const posted: Record<string, unknown>[] = [];
  const win: Record<string, unknown> = {
    _rn_log: () => {},
    ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) },
  };
  new Function('window', terrainReportScript())(win);
  return {
    posted,
    report: win._veloqTerrainReport as {
      watch(map: unknown): void;
      reportOnceSettled(map: unknown): void;
    },
  };
}

describe('terrainReportScript', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports a DEM tile that fails after the map first goes idle', () => {
    const { posted, report } = loadReport();
    const map = fakeMap();
    report.watch(map);
    report.reportOnceSettled(map);

    map.emit('idle');
    jest.advanceTimersByTime(1000);
    expect(posted).toEqual([]);

    map.emit('error', { sourceId: 'terrain', tile: {} });
    jest.advanceTimersByTime(1000);
    expect(posted).toEqual([expect.objectContaining({ type: 'terrainUnavailable' })]);
  });

  it('reports once when failures precede the idle', () => {
    const { posted, report } = loadReport();
    const map = fakeMap();
    report.watch(map);
    report.reportOnceSettled(map);

    map.emit('error', { sourceId: 'terrain', tile: {} });
    map.emit('idle');
    jest.advanceTimersByTime(5000);
    expect(posted).toHaveLength(1);
  });

  it('stays silent when any tile was delivered', () => {
    const { posted, report } = loadReport();
    const map = fakeMap();
    report.watch(map);
    report.reportOnceSettled(map);

    map.emit('sourcedata', { sourceId: 'terrain', tile: {} });
    map.emit('error', { sourceId: 'terrain', tile: {} });
    map.emit('idle');
    jest.advanceTimersByTime(5000);
    expect(posted).toEqual([]);
  });
});
