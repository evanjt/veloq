import { useQuery, keepPreviousData, type QueryKey } from '@tanstack/react-query';
import { bodyNamed, useEngineBody } from '@/shared/native/engineBodies';
import { useRangeCoverage } from '@/shared/native/useRangeCoverage';
import { RangeCoverage, type FfiStartOutcome, type FfiStartResult } from 'veloqrs';

/** A parsed curve with the time the body behind it was fetched. */
interface DatedCurve<TCurve> {
  curve: TCurve;
  /** Epoch milliseconds, or null when the curve has never been fetched. */
  fetchedAt: number | null;
}

interface StoredCurveSource<TCurve> {
  queryKey: QueryKey;
  /** The stored curve and its fetch time, or null for a window never fetched or a body that will not parse. */
  read: () => { curve: TCurve; fetchedAt: number | null } | null | undefined;
  /** Asks Rust to fetch the body behind the curve. */
  sync: () => FfiStartResult | FfiStartOutcome | undefined;
  /** The engine body name that reports the fetch. */
  bodyName: string;
  /** Empty axes while the separate coverage and body status explain the wait. */
  empty: TCurve;
  /** The range the coverage census is taken over. */
  days: number;
  enabled: boolean;
}

/**
 * One stored curve: the query is the only reader of the stored body, `null`
 * is "never fetched" (the cue to ask Rust for it), and the empty curve is what
 * a chart draws in the meantime. SQLite is the source, so a sync decides
 * freshness and not a clock.
 */
export function useStoredCurve<TCurve>(source: StoredCurveSource<TCurve>) {
  const { queryKey, read, sync, bodyName, empty, days, enabled } = source;

  const query = useQuery<DatedCurve<TCurve> | null>({
    queryKey,
    queryFn: () => read() ?? null,
    enabled,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  const body = useEngineBody(
    query.data !== null,
    sync,
    queryKey,
    enabled && query.data !== undefined,
    bodyNamed([bodyName])
  );
  // An empty activity census proves there is nothing to chart. Downloaded
  // activities alone cannot prove the separate curve request has returned.
  const coverage = useRangeCoverage(days, enabled);

  return {
    ...query,
    data: query.data?.curve ?? empty,
    fetchedAt: query.data?.fetchedAt ?? null,
    coverage: query.data
      ? RangeCoverage.Loaded
      : coverage === RangeCoverage.Empty
        ? RangeCoverage.Empty
        : RangeCoverage.NotFetched,
    bodyStatus: body.status,
    retryBody: body.retry,
  };
}
