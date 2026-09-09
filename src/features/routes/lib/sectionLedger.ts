/**
 * Reading the section ledger: dates and the JSON details a row carries.
 */

export interface EventDetails {
  around: string[];
  forkAround: string[];
  prTime?: number;
  prFrom?: number;
  prTo?: number;
  siblings: number;
  version?: number;
  /** The activity a re-anchor moved the line off, and the one it moved to. */
  reanchoredFrom?: string;
  reanchoredTo?: string;
}

/** The ledger writes SQLite datetimes in UTC without a zone marker. */
export function ledgerDate(at: string): Date {
  return new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
}

export function parseEventDetails(details: string | undefined): EventDetails {
  const empty: EventDetails = { around: [], forkAround: [], siblings: 0 };
  if (!details) return empty;
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
    return {
      around: list(d.around),
      forkAround: list(d.fork_around),
      prTime: num(d.pr_time),
      prFrom: num(d.from_time),
      prTo: num(d.to_time),
      siblings: list(d.siblings).length,
      version: num(d.version),
      reanchoredFrom: typeof d.from === 'string' ? d.from : undefined,
      reanchoredTo: typeof d.to === 'string' ? d.to : undefined,
    };
  } catch {
    return empty;
  }
}
