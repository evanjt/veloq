/**
 * Scenario: the top slot holds one banner and several conditions compete for it.
 *
 * Expected behaviour: the offline pill floats and takes no slot, so offline
 * leaves the slot to whatever else claims it, except a failing sync, which has
 * nothing to report while the device is offline and gives the slot up.
 */
import { pickTopBanner, padsStatusBar, type TopBannerState } from '@/shared/app/topBanner';

function state(overrides: Partial<TopBannerState> = {}): TopBannerState {
  return {
    startupErrorShown: false,
    offlineBannerShown: false,
    isAuthenticated: true,
    isDemoMode: false,
    hideDemoBanner: false,
    lastError: null,
    syncPaused: false,
    trackFetchNoticeShown: false,
    engineInitFailed: false,
    ...overrides,
  };
}

describe('pickTopBanner', () => {
  it('claims the slot for a startup error whether or not the device is offline', () => {
    expect(pickTopBanner(state({ startupErrorShown: true }))).toBe('startupError');
    expect(pickTopBanner(state({ startupErrorShown: true, offlineBannerShown: true }))).toBe(
      'startupError'
    );
  });

  it('claims the slot for nothing when offline is all there is, signed in or out', () => {
    expect(pickTopBanner(state({ offlineBannerShown: true }))).toBeNull();
    expect(pickTopBanner(state({ offlineBannerShown: true, isAuthenticated: false }))).toBeNull();
  });

  it('leaves the demo ribbon its slot under the offline pill', () => {
    expect(pickTopBanner(state({ offlineBannerShown: true, isDemoMode: true }))).toBe('demo');
  });

  it('gives up the slot for a stale sync error while the offline pill shows', () => {
    expect(pickTopBanner(state({ offlineBannerShown: true, lastError: 'HTTP 503' }))).toBeNull();
  });

  it('leaves the slot to the paused-sync pill while the engine waits to ask again', () => {
    expect(pickTopBanner(state({ lastError: 'HTTP 429', syncPaused: true }))).toBeNull();
    expect(
      pickTopBanner(state({ lastError: 'HTTP 429', syncPaused: true, isDemoMode: true }))
    ).toBe('demo');
  });

  it('shows the sync error when connected', () => {
    expect(pickTopBanner(state({ lastError: 'HTTP 503' }))).toBe('syncError');
  });

  it('keeps the sync error to a real session, not a demo one', () => {
    expect(pickTopBanner(state({ isDemoMode: true, lastError: 'HTTP 503' }))).toBe('demo');
  });

  it('says nothing about a sync a signed-out athlete does not have', () => {
    expect(pickTopBanner(state({ isAuthenticated: false, lastError: 'HTTP 503' }))).toBeNull();
  });

  it('shows the demo ribbon until it is dismissed', () => {
    expect(pickTopBanner(state({ isDemoMode: true }))).toBe('demo');
    expect(pickTopBanner(state({ isDemoMode: true, hideDemoBanner: true }))).toBeNull();
  });

  /**
   * While the offline pill's delay runs the device reads offline and the pill
   * is not up yet. The sync-error banner stays up through that delay, so the
   * slot stays its own until the pill shows.
   */
  it('keeps the slot for a sync error while the offline pill is still held back', () => {
    expect(pickTopBanner(state({ offlineBannerShown: false, lastError: 'HTTP 503' }))).toBe(
      'syncError'
    );
  });

  it('claims the slot for nothing when connected with no error', () => {
    expect(pickTopBanner(state())).toBeNull();
  });
});

describe('banners the pick used to leave out', () => {
  it('claims the slot for the track notice alone, so screens drop their top edge', () => {
    expect(pickTopBanner(state({ trackFetchNoticeShown: true }))).toBe('trackFetch');
  });

  it('claims the slot for a failed engine open', () => {
    expect(pickTopBanner(state({ engineInitFailed: true }))).toBe('engineInit');
  });

  it('lets the demo ribbon stand under the track notice', () => {
    expect(pickTopBanner(state({ isDemoMode: true, trackFetchNoticeShown: true }))).toBe(
      'trackFetch'
    );
  });
});

describe('padsStatusBar', () => {
  it('pads only the banner the pick chose, so a stack carries one inset', () => {
    const active = pickTopBanner(state({ isDemoMode: true, trackFetchNoticeShown: true }));
    expect(padsStatusBar(active, 'trackFetch')).toBe(true);
    expect(padsStatusBar(active, 'demo')).toBe(false);
  });

  it('pads a banner shown without the provider, as a standalone render', () => {
    expect(padsStatusBar(undefined, 'demo')).toBe(true);
  });
});
