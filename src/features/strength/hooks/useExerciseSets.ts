import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import type { ActivityHighlightsBundle, ExerciseSession, MuscleGroup } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { queryKeys } from '@/shared/query/queryKeys';
import { useReconnect } from '@/shared/app/useRetryTriggers';

import { demoStrengthSets } from '../demo';
import type { StrengthCardData } from '../components/StrengthActivityCard';
import { debug } from '@/shared/debug/debug';

const log = debug.create('ExerciseSets');

function isDemo(): boolean {
  return useAuthStore.getState().isDemoMode;
}

/**
 * Ask the engine to download and read one activity's FIT file, for whatever
 * its sport takes from it: a strength session's sets, a pool swim's lengths.
 * The read lands in the engine and announces `fitParsed`; nothing is returned.
 */
export function requestFitFile(activityId: string): void {
  getEngine()?.fetchAndParseExerciseSets(activityId);
}

/**
 * Fetch and cache exercise set data for a WeightTraining activity.
 *
 * On first view Rust downloads the FIT file in the background, parses it and
 * writes the sets to SQLite. The query reads what is stored, asks for a fetch
 * when nothing is, and then waits for the engine to announce the parse rather
 * than re-reading on a timer.
 *
 * A row in the engine's FIT status table means the activity has settled: parsed,
 * or genuinely carrying no sets, or absent upstream. A download that failed for
 * any other reason records nothing and announces nothing, so nothing wakes this
 * query: the empty list it cached is what every later visit renders. The
 * reconnect edge is what asks again, through `useStrengthReconnect`.
 *
 * `outcome` is that distinction, carried out to the caller. An empty list alone
 * cannot say whether the athlete logged no sets or the download never landed,
 * and the table drew the same nothing for both.
 */
/** What the engine holds for one activity, and whether it has settled it. */
interface ExerciseSetsRead {
  session: ExerciseSession;
  /** A FIT status row exists, so there is nothing more to download. */
  settled: boolean;
}

/** No sets and no verdict: the download is owed, in flight, or failed. */
const EMPTY_SESSION: ExerciseSession = {
  sets: [],
  groups: [],
  activeSetCount: 0,
  exerciseCount: 0,
  totalVolumeKg: 0,
  totalDurationSecs: 0,
};
const unsettled: ExerciseSetsRead = { session: EMPTY_SESSION, settled: false };

/**
 * What an empty list means. `pending` is every kind of ignorance: the read has
 * not run, the engine is not open, the FIT download is in flight, and the
 * retryable failure that records no status row at all.
 */
export type ExerciseSetsOutcome = 'loaded' | 'empty' | 'pending';

function outcomeOf(read: ExerciseSetsRead | undefined): ExerciseSetsOutcome {
  if (!read) return 'pending';
  if (read.session.sets.length > 0) return 'loaded';
  return read.settled ? 'empty' : 'pending';
}

export function useExerciseSets(activityId: string, activityType: string) {
  const enabled = activityType === 'WeightTraining' && !!activityId;
  const queryClient = useQueryClient();

  // Whether the engine has settled this activity, read alongside the sets so
  // the two cannot disagree: a settled activity with no sets has none, and an
  // unsettled one is a download still owed.
  const query = useQuery<ExerciseSetsRead>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.strength.exerciseSets(activityId),
    queryFn: () => {
      const engine = getEngine();
      if (!engine) return unsettled;

      // Check if strength() method exists (requires Rust rebuild with StrengthManager)
      if (typeof engine.getExerciseSets !== 'function') {
        log.log('[ExerciseSets] getExerciseSets not available - rebuild required');
        return unsettled;
      }

      try {
        const cached = engine.getExerciseSets(activityId);
        if (cached.sets.length > 0) return { session: cached, settled: true };

        // A settled activity has nothing more to fetch, whether or not it has sets.
        if (engine.isFitProcessed(activityId)) return { session: EMPTY_SESSION, settled: true };

        // Demo mode has no FIT file - seed synthetic sets for any fixture
        // activity that carries one, then read back through the normal path.
        if (isDemo() && demoStrengthSets[activityId]) {
          if (typeof engine.bulkInsertExerciseSets !== 'function') {
            log.log('[ExerciseSets] bulkInsertExerciseSets not available - rebuild required');
            return unsettled;
          }
          engine.bulkInsertExerciseSets(activityId, demoStrengthSets[activityId]);
          return { session: engine.getExerciseSets(activityId), settled: true };
        }

        requestFitFile(activityId);
        return unsettled;
      } catch (err) {
        console.error('[ExerciseSets] Error:', err);
        return unsettled;
      }
    },
    enabled,
    staleTime: Infinity, // exercise data never changes
    gcTime: 1000 * 60 * 60 * 2, // 2 hours in memory
  });

  useEffect(() => {
    const engine = enabled ? getEngine() : null;
    if (!engine) return undefined;

    return engine.subscribe('fitParsed', (payload) => {
      if (payload && 'activityId' in payload && payload.activityId !== activityId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.strength.exerciseSets(activityId),
      });
    });
  }, [activityId, enabled, queryClient]);

  return {
    ...query,
    data: query.data?.session.sets ?? EMPTY_SESSION.sets,
    session: query.data?.session ?? EMPTY_SESSION,
    outcome: outcomeOf(query.data),
  };
}

/**
 * Re-ask for the FIT downloads a dead connection lost, once the radio is back.
 *
 * Mounted for the life of the app rather than inside `useExerciseSets`: the
 * edge can pass while no strength screen is open, and invalidating a key
 * nobody holds costs nothing. Without it the empty list cached under
 * `staleTime: Infinity` stands for the rest of the session, because a
 * transport failure records no FIT status row and so announces no parse.
 */
export function useStrengthReconnect(): void {
  const queryClient = useQueryClient();
  useReconnect(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.strength.all });
  });
}

/**
 * Get aggregated muscle groups for an activity's exercises.
 * Returns slugs compatible with react-native-body-highlighter.
 */
export function useMuscleGroups(activityId: string, hasExercises: boolean) {
  return useQuery<MuscleGroup[]>({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.strength.muscleGroups(activityId),
    queryFn: () => {
      const engine = getEngine();
      if (!engine || typeof engine.getMuscleGroups !== 'function') return [];

      return engine.getMuscleGroups(activityId);
    },
    enabled: hasExercises && !!activityId,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 2,
  });
}

const NO_CARDS = new Map<string, StrengthCardData>();

/**
 * What the strength cards of a feed paint, from the rows the feed's one
 * highlights read already carries.
 *
 * A row with no sets and no recorded FIT outcome is a download still owed: it
 * is asked for here, once per activity, and the parse announces `fitParsed`,
 * which reads the feed's highlights again. The reconnect edge clears what was
 * asked, because a download a dead connection refused records nothing and
 * announces nothing.
 *
 * Only an activity with active sets gets an entry, so a card without one draws
 * as an ordinary card. An entry keeps its identity while its content holds, so
 * a re-read after another activity's parse does not redraw the rest.
 */
export function useStrengthCardData(
  rows: ActivityHighlightsBundle['strengthCards']
): Map<string, StrengthCardData> {
  const [retry, setRetry] = useState(0);
  const asked = useRef(new Set<string>());
  const identity = useRef(new Map<string, { key: string; value: StrengthCardData }>());

  useReconnect(() => {
    asked.current.clear();
    setRetry((n) => n + 1);
  });

  const cards = useMemo(() => {
    if (rows.length === 0) return NO_CARDS;
    const next = new Map<string, StrengthCardData>();
    for (const row of rows) {
      if (row.activeSetCount === 0) continue;
      const data: StrengthCardData = {
        muscles: row.muscles.map(
          (g): ExtendedBodyPart => ({
            slug: g.slug as NonNullable<ExtendedBodyPart['slug']>,
            intensity: g.intensity,
          })
        ),
        exerciseCount: row.exerciseCount,
        setCount: row.activeSetCount,
        totalWeight: row.totalVolumeKg,
      };
      const key = JSON.stringify(data);
      // This hook's own cache of what it last handed out, never anything drawn from it.
      // eslint-disable-next-line react-hooks/refs
      const held = identity.current.get(row.activityId);
      if (held && held.key === key) {
        next.set(row.activityId, held.value);
      } else {
        // eslint-disable-next-line react-hooks/refs
        identity.current.set(row.activityId, { key, value: data });
        next.set(row.activityId, data);
      }
    }
    return next;
  }, [rows]);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;
    for (const row of rows) {
      if (row.settled || asked.current.has(row.activityId)) continue;
      asked.current.add(row.activityId);
      // Demo mode has no FIT file: the seed lands the sets and announces them.
      const seed = isDemo() ? demoStrengthSets[row.activityId] : undefined;
      try {
        if (seed) {
          engine.bulkInsertExerciseSets(row.activityId, seed);
        } else {
          requestFitFile(row.activityId);
        }
      } catch (err) {
        console.error('[StrengthCards] Error:', err);
      }
    }
  }, [rows, retry]);

  return cards;
}
