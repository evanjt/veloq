/**
 * Reading the section ledger: dates and the JSON details a row carries.
 */

export interface EventDetails {
  around: string[];
  forkAround: string[];
  /**
   * The era's records, one per sport. A record is held within one sport; a
   * row written before that carries one record and no sport.
   */
  prs: EraRecord[];
  prFrom?: number | undefined;
  prTo?: number | undefined;
  /** The sport a re-based record moved within, absent on an older row. */
  prSport?: string | undefined;
  siblings: number;
  version?: number | undefined;
  /** The activity a re-anchor moved the line off, and the one it moved to. */
  reanchoredFrom?: string | undefined;
  reanchoredTo?: string | undefined;
  /** Whether an anchoring moved the line; absent on a row that does not say. */
  moved?: boolean | undefined;
  splitFrom?: string | undefined;
  siblingIds: string[];
  splitFromLink?: SectionLink | undefined;
  splitIntoLinks: SectionLink[];
}

export interface EraRecord {
  sport?: string | undefined;
  time: number;
}

export interface SectionLink {
  id: string;
  name: string | null;
  available: boolean;
}

/**
 * The ledger kinds whose label is one fixed string. `split`, `reverted` and
 * `reference_anchored` need a count, a version or the row's details to word.
 */
export const FIXED_LABEL_LEDGER_KINDS: ReadonlySet<string> = new Set([
  'formed',
  'restored',
  'recut',
  'dissolved',
  'merged',
  'superseded',
  'pr_rebased',
  'baseline',
  'reference_reanchored',
  'name_released',
  'name_taken',
  'algorithm_changed',
  'trimmed',
  'expanded',
  'bounds_reset',
  'reference_set',
  'reference_reset',
  'accepted',
  'renamed',
  'absorbed',
]);

/** The ledger writes SQLite datetimes in UTC without a zone marker. */
export function ledgerDate(at: string): Date {
  return new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
}

export function parseEventDetails(details: string | undefined): EventDetails {
  const empty: EventDetails = {
    around: [],
    forkAround: [],
    prs: [],
    siblings: 0,
    siblingIds: [],
    splitIntoLinks: [],
  };
  if (!details) return empty;
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
    const link = (v: unknown): SectionLink | undefined => {
      if (typeof v !== 'object' || v === null) return undefined;
      const value = v as Record<string, unknown>;
      if (typeof value.id !== 'string' || typeof value.available !== 'boolean') return undefined;
      return {
        id: value.id,
        name: typeof value.name === 'string' ? value.name : null,
        available: value.available,
      };
    };
    const eraRecords = (): EraRecord[] => {
      if (typeof d.prs === 'object' && d.prs !== null && !Array.isArray(d.prs)) {
        return Object.entries(d.prs as Record<string, unknown>)
          .flatMap(([sport, record]) => {
            if (typeof record !== 'object' || record === null) return [];
            const time = num((record as Record<string, unknown>).time);
            return time === undefined ? [] : [{ sport, time }];
          })
          .sort((a, b) => a.sport.localeCompare(b.sport));
      }
      const legacy = num(d.pr_time);
      return legacy === undefined ? [] : [{ sport: undefined, time: legacy }];
    };
    return {
      around: list(d.around),
      forkAround: list(d.fork_around),
      prs: eraRecords(),
      prFrom: num(d.from_time),
      prTo: num(d.to_time),
      prSport: typeof d.sport === 'string' ? d.sport : undefined,
      siblings: list(d.siblings).length,
      siblingIds: list(d.siblings),
      version: num(d.version),
      reanchoredFrom: typeof d.from === 'string' ? d.from : undefined,
      reanchoredTo: typeof d.to === 'string' ? d.to : undefined,
      moved: typeof d.moved === 'boolean' ? d.moved : undefined,
      splitFrom: typeof d.split_from === 'string' ? d.split_from : undefined,
      splitFromLink: link(d.split_from_link),
      splitIntoLinks: Array.isArray(d.split_into_links)
        ? d.split_into_links.flatMap((value) => {
            const parsed = link(value);
            return parsed ? [parsed] : [];
          })
        : [],
    };
  } catch {
    return empty;
  }
}

/** A change, as much of one as the chip ids need. */
interface ChipSource {
  details?: string | undefined;
}

/**
 * Every activity id the history panel will draw a chip for, once each and in
 * the order they appear.
 *
 * Capped per list, the way the panel caps its own rows, so a section with
 * hundreds of traversals does not ask the engine for names nothing will draw.
 */
export function ledgerChipIds(history: ChipSource[], maxPerList: number): string[] {
  const seen = new Set<string>();
  for (const event of history) {
    const details = parseEventDetails(event.details);
    for (const list of [details.around, details.forkAround]) {
      for (const id of list.slice(0, maxPerList)) seen.add(id);
    }
  }
  return [...seen];
}
