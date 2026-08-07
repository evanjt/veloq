/**
 * Scenario: the backup screen picker lists backends by id and selects the one
 * that was tapped.
 * Expected behaviour: WebDAV stays offerable before it has credentials,
 * because the screen configures it. A backend that reports itself unavailable
 * with no in-app way to fix that is not offered at all.
 */

const mockGetSetting = jest.fn<string | undefined, [string]>();

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => ({
    getSetting: (key: string) => mockGetSetting(key),
    setSetting: jest.fn(),
  }),
}));

import { getOfferableBackends, getAvailableBackends } from '@/features/settings/lib/autobackup';

describe('getOfferableBackends', () => {
  beforeEach(() => {
    mockGetSetting.mockReset();
    mockGetSetting.mockReturnValue(undefined);
  });

  it('offers WebDAV even though it is not yet configured', async () => {
    const available = (await getAvailableBackends()).map((b) => b.id);
    const offerable = (await getOfferableBackends()).map((b) => b.id);

    expect(available).not.toContain('webdav');
    expect(offerable).toContain('webdav');
    expect(offerable).toContain('local');
  });

  it('offers only backends that exist in the registry', async () => {
    const offerable = await getOfferableBackends();

    for (const backend of offerable) {
      expect(typeof backend.id).toBe('string');
      expect(typeof backend.upload).toBe('function');
    }
    expect(offerable.map((b) => b.id)).not.toContain('icloud');
  });
});
