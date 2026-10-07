import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

const mockSetSetting = jest.fn().mockResolvedValue(undefined);
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

/**
 * Expected behaviour: dismissing an auto-triggered tour marks the running version seen,
 * whether or not that version has slides of its own.
 */
describe('WhatsNewStore.dismissTour', () => {
  beforeEach(() => {
    mockSetSetting.mockClear();
    useWhatsNewStore.setState({ lastSeenVersion: '0.3.0', tourState: null });
  });

  it('marks a version with no slides seen after a tour left from the exploring state', async () => {
    const store = useWhatsNewStore.getState();
    store.startTour('whatsNew');
    store.showMe(2, 'tip');
    await useWhatsNewStore.getState().dismissTour('9.9.9');
    expect(mockSetSetting).toHaveBeenCalledWith('veloq-whats-new-seen', '9.9.9');
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('9.9.9');
    expect(useWhatsNewStore.getState().tourState).toBeNull();
  });

  it('writes nothing when the version is already seen', async () => {
    useWhatsNewStore.setState({ lastSeenVersion: '9.9.9' });
    useWhatsNewStore.getState().startTour('whatsNew');
    await useWhatsNewStore.getState().dismissTour('9.9.9');
    expect(mockSetSetting).not.toHaveBeenCalled();
    expect(useWhatsNewStore.getState().tourState).toBeNull();
  });

  it('ends the tour even when the write fails', async () => {
    mockSetSetting.mockRejectedValueOnce(new Error('disk'));
    useWhatsNewStore.getState().startTour('tutorial');
    await useWhatsNewStore
      .getState()
      .dismissTour('9.9.9')
      .catch(() => {});
    expect(useWhatsNewStore.getState().tourState).toBeNull();
  });
});
