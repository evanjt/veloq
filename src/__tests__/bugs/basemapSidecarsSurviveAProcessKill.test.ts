/**
 * Scenario: the basemap store writes a source's `index.json` only every 32
 * operations, and Android kills the app process without unwinding it, so the
 * `Drop` that would write it back never runs. A source that never crossed the
 * cadence had no sidecar at all, and the next launch rebuilt its index by
 * walking the whole tree: measured at about 330 ms on the S22 at the 400 MB
 * ceiling, blocking, on the thread the settings hub mounts on.
 *
 * Expected behaviour: the app flushes the sidecars when it goes to the
 * background, and never throws doing it.
 */
import { basemap } from '../__shared__/veloqrsStub';
import { flushBasemapSidecars } from '@/features/maps/lib/basemapFlush';
import { handleAppBackground } from '@/shared/app/appBackground';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
const mockBackup = jest.fn();
jest.mock('@/features/settings/lib/autobackup', () => ({
  onAppBackground: () => mockBackup(),
}));
const mockWidget = jest.fn();
jest.mock('@/features/home/lib/widgetBridge', () => ({
  updateWidgetSnapshot: () => mockWidget(),
}));

beforeEach(() => {
  mockBackup.mockClear();
  mockWidget.mockClear();
  basemap.flush.mockClear();
  basemap.flush.mockImplementation(() => undefined);
});

describe('flushing the basemap sidecars', () => {
  it('writes every source back through the store', () => {
    flushBasemapSidecars();

    expect(basemap.flush).toHaveBeenCalledTimes(1);
  });

  it('swallows a store that throws, because backgrounding must not fail', () => {
    basemap.flush.mockImplementation(() => {
      throw new Error('no basemap tile path has been set');
    });

    expect(() => flushBasemapSidecars()).not.toThrow();
  });

  it('survives the module being absent, which is the web and the test run', () => {
    jest.isolateModules(() => {
      jest.doMock('veloqrs', () => {
        throw new Error('Turbo Module not found');
      });
      const { flushBasemapSidecars: isolated } =
        require('@/features/maps/lib/basemapFlush') as typeof import('@/features/maps/lib/basemapFlush');

      expect(() => isolated()).not.toThrow();
    });
  });
});

describe('the app lifecycle', () => {
  it('flushes them when the app goes to the background', () => {
    handleAppBackground();

    expect(basemap.flush).toHaveBeenCalledTimes(1);
  });

  it('still backs up and refreshes the widget beside the flush', () => {
    handleAppBackground();

    expect(mockBackup).toHaveBeenCalledTimes(1);
    expect(mockWidget).toHaveBeenCalledTimes(1);
  });
});
