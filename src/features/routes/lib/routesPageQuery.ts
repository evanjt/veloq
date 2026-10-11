/**
 * Which list a routes screen read pages. The first page, and a load-more of
 * each list before either lands, read both; a single load-more reads the next
 * page of one list and none of the other, which the screen already holds.
 */
export type RoutesPageKind = 'both' | 'groups' | 'sections';

export interface RoutesPaging {
  groupOffset: number;
  sectionOffset: number;
  groupLimit: number;
  sectionLimit: number;
}

export interface RoutesHasMore {
  hasMoreGroups: boolean;
  hasMoreSections: boolean;
}

/**
 * The paging half of a routes screen read. The list not being paged is asked
 * for no rows, since a page of it would be read with its polylines and thrown
 * away by the accumulator.
 */
export function routesPageQuery(kind: RoutesPageKind, paging: RoutesPaging): RoutesPaging {
  if (kind === 'groups') {
    return {
      groupOffset: paging.groupOffset,
      groupLimit: paging.groupLimit,
      sectionOffset: 0,
      sectionLimit: 0,
    };
  }
  if (kind === 'sections') {
    return {
      groupOffset: 0,
      groupLimit: 0,
      sectionOffset: paging.sectionOffset,
      sectionLimit: paging.sectionLimit,
    };
  }
  return { ...paging };
}

/**
 * Whether each list has another page after a read. A list read with no rows
 * keeps what its own last read said: the engine counts more whenever the
 * filtered total exceeds the offset plus the page, which an empty page at
 * offset zero always does, so taking its answer would page a finished list
 * for ever.
 */
export function mergeHasMore(
  kind: RoutesPageKind,
  read: RoutesHasMore,
  previous: RoutesHasMore
): RoutesHasMore {
  return {
    hasMoreGroups: kind === 'sections' ? previous.hasMoreGroups : read.hasMoreGroups,
    hasMoreSections: kind === 'groups' ? previous.hasMoreSections : read.hasMoreSections,
  };
}
