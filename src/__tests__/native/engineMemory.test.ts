/**
 * Expected behaviour: a memory release reaches the engine once with its level,
 * is safe before the engine exists, and a release the engine refuses is logged
 * rather than left as an unhandled rejection inside a trim callback.
 */
import { releaseEngineMemory } from '@/shared/native/engineMemory';

const mockReleaseMemory = jest.fn();
let mockEngine: { releaseMemory: typeof mockReleaseMemory } | null = null;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

describe('releaseEngineMemory', () => {
  beforeEach(() => {
    mockReleaseMemory.mockReset();
    mockEngine = { releaseMemory: mockReleaseMemory };
  });

  it('asks the engine once, at the level it was given', async () => {
    mockReleaseMemory.mockResolvedValue(undefined);
    await releaseEngineMemory(true);
    expect(mockReleaseMemory.mock.calls).toEqual([[true]]);
  });

  it('does nothing before the engine exists', async () => {
    mockEngine = null;
    await expect(releaseEngineMemory(false)).resolves.toBeUndefined();
  });

  it('settles a release the engine refuses', async () => {
    mockReleaseMemory.mockRejectedValue(new Error('busy'));
    await expect(releaseEngineMemory(true)).resolves.toBeUndefined();
    expect(mockReleaseMemory).toHaveBeenCalledTimes(1);
  });

  it('settles a release that throws before it returns a promise', async () => {
    mockReleaseMemory.mockImplementation(() => {
      throw new Error('torn down');
    });
    await expect(releaseEngineMemory(false)).resolves.toBeUndefined();
  });
});
