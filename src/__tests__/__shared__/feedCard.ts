import { StubVerdict } from 'veloqrs';
import type { FeedCard } from '@/types';

/**
 * A feed card as the engine hands it over, with every figure the card draws
 * absent unless a case sets it.
 */
export function feedCard(overrides: Partial<FeedCard> & Pick<FeedCard, 'id'>): FeedCard {
  return {
    name: '',
    startDateLocal: '',
    hasWeather: false,
    hasGps: false,
    hasAltitude: false,
    stub: StubVerdict.NotStub,
    ...overrides,
  };
}
