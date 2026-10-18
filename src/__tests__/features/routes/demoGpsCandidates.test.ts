/**
 * Scenario: demo mode pulls no census, so the tracks a demo session still owes
 * come from the feed cards over the sync window.
 *
 * Expected behaviour: a card with a track the engine does not hold is a
 * candidate carrying its sport and start; a card already stored or with no
 * track is not; a card that names no sport is fetched as a ride.
 */
import { demoGpsCandidates } from '@/features/routes/lib/demoGpsCandidates';
import { activityStartEpoch } from '@/shared/activity/streamWindow';
import type { FeedCard } from '@/types';
import { feedCard } from '../../__shared__/feedCard';

const card = (id: string, hasGps: boolean, extra: Partial<FeedCard> = {}): FeedCard =>
  feedCard({ id, startDateLocal: '2026-03-16T06:30:00', hasGps, ...extra });

describe('demoGpsCandidates', () => {
  it('owes a track for a card with one the engine does not hold', () => {
    const candidates = demoGpsCandidates(
      [card('fresh', true, { sportType: 'Run' })],
      new Set(['stored'])
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        activityId: 'fresh',
        sportType: 'Run',
        startDate: activityStartEpoch('2026-03-16T06:30:00'),
      }),
    ]);
  });

  it('owes nothing for a stored track or a card with none', () => {
    const candidates = demoGpsCandidates(
      [card('stored', true, { sportType: 'Ride' }), card('pool', false, { sportType: 'Swim' })],
      new Set(['stored'])
    );

    expect(candidates).toEqual([]);
  });

  it('fetches a card that names no sport as a ride', () => {
    const [candidate] = demoGpsCandidates([card('plain', true)], new Set());

    expect(candidate?.sportType).toBe('Ride');
  });

  it('owes nothing over an empty window', () => {
    expect(demoGpsCandidates([], new Set(['stored']))).toEqual([]);
  });
});
