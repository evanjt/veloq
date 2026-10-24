/**
 * Scenario: the athlete prefers one of two sections on the same ground.
 *
 * Expected behaviour: the engine is asked once with the kept section first,
 * sections readers are told once it has ended, and a refusal resolves false
 * without telling anyone.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockSections = { preferSection: jest.fn() };
const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  sections: () => mockSections,
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: { create: () => mockNativeEngine },
}));

function openClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialised = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).pendingWrites = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  expect(client.initWithPath('/data/routes.db')).toBe(true);
  return client;
}

describe('preferSection', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('notifies sections readers only once the engine has finished', async () => {
    const client = openClient();
    const notify = jest.spyOn(client, 'notifyAll');
    let finish: () => void = () => {};
    mockSections.preferSection.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));

    const pending = client.preferSection('kept-1', 'other-1');
    await Promise.resolve();
    expect(mockSections.preferSection).toHaveBeenCalledWith('kept-1', 'other-1');
    expect(notify).not.toHaveBeenCalled();

    finish();
    await expect(pending).resolves.toBe(true);
    expect(notify).toHaveBeenCalledWith('sections');
  });

  it('resolves false and notifies nobody when the engine refuses the pair', async () => {
    const client = openClient();
    const notify = jest.spyOn(client, 'notifyAll');
    mockSections.preferSection.mockRejectedValue(new Error('do not share ground'));

    await expect(client.preferSection('kept-1', 'other-1')).resolves.toBe(false);

    expect(notify).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('refuses an empty id before calling the engine', async () => {
    const client = openClient();

    await expect(client.preferSection('', 'other-1')).rejects.toThrow();

    expect(mockSections.preferSection).not.toHaveBeenCalled();
  });
});
