/**
 * Scenario: the delta chart scrubs a distance and the map under the sheet reads it from the
 * card's state in the host's entry.
 *
 * Expected behaviour: the card writes the distance, the map reads it, and a clear reads null.
 */
import { act, renderHook } from '@testing-library/react-native';

import { detailCardWriter, useCardScrub } from '../detailCardState';
import { closeHost, openHost } from '@/shared/app/mapSheetHost';

const KEY = 'section:scrub-card';

beforeEach(() => openHost('section', 'scrub-card'));
afterEach(() => closeHost(KEY));

describe('the card scrub distance', () => {
  it('reads null before any scrub', async () => {
    const { result } = await renderHook(() => useCardScrub(KEY));
    expect(result.current).toBeNull();
  });

  it('reads the written distance, then null after the clear', async () => {
    const { result } = await renderHook(() => useCardScrub(KEY));
    const card = detailCardWriter(KEY, 0);
    await act(async () => card.setScrubDistance(120));
    expect(result.current).toBe(120);
    await act(async () => card.setScrubDistance(null));
    expect(result.current).toBeNull();
  });

  it('keeps a scrub at distance 0', async () => {
    const { result } = await renderHook(() => useCardScrub(KEY));
    await act(async () => detailCardWriter(KEY, 0).setScrubDistance(0));
    expect(result.current).toBe(0);
  });
});
