/**
 * Scenario: Rust reports a bulk export's skips by reason, as no track, trimmed
 * by the privacy setting, and failed, and the client wrapper hands the result
 * on to the export screen.
 *
 * Expected behaviour: all three counts cross the wrapper, so the screen can
 * name each reason rather than calling every skip GPS-less.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  runBulkExport: jest.fn(),
  settings: () => ({ getSetting: jest.fn(), setSetting: jest.fn() }),
  heatmap: () => ({ setTilesPath: jest.fn(), clearTilesPath: jest.fn() }),
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  __esModule: true,
  default: { initialize: jest.fn() },
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: { create: () => mockNativeEngine },
}));

function openClient() {
  const client = EngineClient.getInstance();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).initialized = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).dbPath = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).engine = null;
  expect(client.initWithPath('/data/routes.db')).toBe(true);
  return client;
}

it('hands on each skip reason Rust counted', async () => {
  mockNativeEngine.runBulkExport.mockResolvedValue({
    exported: 400,
    noTrack: 40,
    trimmed: 3,
    failed: 1,
    totalBytes: BigInt(8_400_000),
  });
  const client = openClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await expect(client.runBulkExport(0 as any, '/cache/all.zip')).resolves.toEqual({
    exported: 400,
    noTrack: 40,
    trimmed: 3,
    failed: 1,
    totalBytes: 8_400_000,
  });
});
