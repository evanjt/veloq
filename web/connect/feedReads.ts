// What the activities page reads: the summary strip, the pages of the list
// under one filter, the chips under each card and the figures of the card
// pointed at. Each is a read of the query layer, so two views of the same
// filter share its answers and a changed filter reads only what it has not.

import { useEffect, useMemo, useState } from 'react';

import {
  FEED_PAGE_SIZE,
  FEED_SPARKLINE_DAYS,
  feedChips,
  feedPageAsk,
  feedRows,
  type FeedFilter,
} from './link';
import { settledNow, wallSeconds } from './fitness';
import type { ReadState } from './query';
import type { Methods } from './schema';
import { useQueries, useRead, useReads, type Read } from './useRead';

/** What the phone serves for one activity in the list. */
export type Card = {
  id: string;
  name: string;
  startDateLocal?: string;
  sportType?: string;
  /** Whether the activity recorded a track. */
  hasGps?: boolean;
  distance?: number | null;
  movingTime?: number | null;
  elevationGain?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  trainingLoad?: number | null;
};

/** What the phone serves for one activity's summary. */
export type Detail = {
  id: string;
  movingTime?: number | null;
  elapsedTime?: number | null;
  averageSpeed?: number | null;
  maxSpeed?: number | null;
};

export type Summary = Methods['feed.summary']['result'];
export type Sparklines = Methods['feed.sparklines']['result'];

export type FeedReads = {
  cards: Card[];
  /** Whether the phone holds more cards past those listed. */
  more: boolean;
  loadMore: () => void;
  /** The first page: loading, or the error that left the list empty. */
  first: ReadState<unknown> & { retry: () => void };
  summary: Read<Methods['feed.summary']['result']>;
  sparklines: Read<Methods['feed.sparklines']['result']>;
  /** Stored activities per sport family under the search and window; a family with none is absent. */
  familyCounts: Readonly<Partial<Record<string, number>>>;
  /** The activities the filter's text leaves under the chips and window; undefined until the phone answers. */
  matched: number | undefined;
  /** The activities the same chips and window leave without the text; undefined until the phone answers. */
  total: number | undefined;
  /** The chips under each card, by card id. */
  highlights: Readonly<Record<string, string[]>>;
  /** Each card's preview line, base64, by card id. */
  previews: Readonly<Record<string, string>>;
};

/** The feed under `filter`, growing a page at a time. */
export function useFeed(filter: FeedFilter): FeedReads {
  const client = useQueries();
  const filterKey = JSON.stringify(filter);
  const [grown, setGrown] = useState({ key: filterKey, pages: 1 });
  const pages = grown.key === filterKey ? grown.pages : 1;

  const nowWallSeconds = useMemo(() => wallSeconds(settledNow()), []);
  const summary = useRead('feed.summary', { nowWallSeconds });
  const sparklines = useRead('feed.sparklines', { days: FEED_SPARKLINE_DAYS });

  const asks = Array.from({ length: pages }, (_, at) => ({
    method: 'feed.page',
    args: feedPageAsk(filter, at * FEED_PAGE_SIZE),
  }));
  const states = useReads(asks) as readonly ReadState<Methods['feed.page']['result']>[];

  const { cards, previews, ids } = useMemo(() => {
    let rows: Card[] = [];
    const lines: Record<string, string> = {};
    states.forEach((state, at) => {
      if (!state.data) return;
      rows = feedRows(rows, state.data.cards as Card[], at * FEED_PAGE_SIZE);
      for (const preview of state.data.previews) lines[preview.activityId] = preview.encodedCoords;
    });
    return { cards: rows, previews: lines, ids: rows.map((row) => row.id) };
  }, [states]);

  const chipStates = useReads(
    states.map((state) =>
      state.data && state.data.cards.length > 0
        ? { method: 'feed.highlights', args: { ids: state.data.cards.map((card) => card.id) } }
        : null
    )
  ) as readonly ReadState<Methods['feed.highlights']['result']>[];
  const highlights = useMemo(() => {
    let held: Record<string, string[]> = {};
    chipStates.forEach((state, at) => {
      const page = states[at]?.data;
      if (state.data && page) {
        held = feedChips(
          held,
          page.cards.map((card) => card.id),
          state.data
        );
      }
    });
    return held;
  }, [chipStates, states]);

  const idsKey = ids.join('\n');
  useEffect(() => {
    // An activity's stored series is kept only while the list carries it.
    client.keepOnly(idsKey === '' ? [] : idsKey.split('\n'));
  }, [client, idsKey]);

  const firstPage = states[0]?.data;
  const familyCounts = useMemo(
    () =>
      Object.fromEntries(
        (firstPage?.familyCounts ?? []).map(({ family, count }) => [family, count])
      ),
    [firstPage]
  );

  // With no text the first page already answers the total; with text the same ask without it
  // is read for one row, since only its count is wanted.
  const unfiltered = useRead(
    'feed.page',
    filter.needle === '' ? null : { ...feedPageAsk({ ...filter, needle: '' }, 0), limit: 1 }
  );
  const matched = firstPage?.matchedCount;
  const total = filter.needle === '' ? matched : unfiltered.data?.matchedCount;

  const last = states[states.length - 1];
  const more = last?.data?.hasMore === true;
  const loadMore = () => {
    if (!more || last?.loading || last?.refreshing) return;
    setGrown({ key: filterKey, pages: pages + 1 });
  };
  return {
    cards,
    more,
    loadMore,
    first: {
      ...(states[0] ?? { data: undefined, loading: false, refreshing: false, error: null }),
      retry: () => client.retry('feed.page', feedPageAsk(filter, 0)),
    },
    summary,
    sparklines,
    familyCounts,
    matched,
    total,
    highlights,
    previews,
  };
}

/** What the phone serves for each activity of `ids`, for the figures beside the list. */
export function useDetails(ids: readonly string[]): Readonly<Record<string, Detail>> {
  const unique = [...new Set(ids)];
  const states = useReads(unique.map((id) => ({ method: 'activity.summary', args: { id } })));
  return useMemo(() => {
    const details: Record<string, Detail> = {};
    unique.forEach((id, at) => {
      const answer = states[at]?.data as Omit<Detail, 'id'> | undefined;
      if (answer) details[id] = { id, ...answer };
    });
    return details;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states]);
}
