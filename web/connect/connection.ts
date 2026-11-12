// What the page shows of its connection: the chip's word and colour, the path
// and round trip the browser's own stats name, and the traffic the popover
// plots. Pure, so a test drives it with states and stats rows and no browser.

import type { ParseKeys } from 'i18next';

import type { State } from './link';

/** The word the page shows for each link state, as a key of the page's strings. */
export const STATUS: Record<State['name'], ParseKeys> = {
  unpaired: 'connectPage.status.unpaired',
  inviting: 'connectPage.status.inviting',
  proving: 'connectPage.status.proving',
  confirming: 'connectPage.status.confirming',
  waiting: 'connectPage.status.waiting',
  connecting: 'connectPage.status.connecting',
  connected: 'connectPage.status.connected',
  update: 'connectPage.status.update',
};

export type Tone = 'live' | 'waiting' | 'idle' | 'warning';

const TONE: Record<State['name'], Tone> = {
  unpaired: 'idle',
  inviting: 'waiting',
  proving: 'waiting',
  confirming: 'waiting',
  waiting: 'waiting',
  connecting: 'waiting',
  connected: 'live',
  update: 'warning',
};

/** The chip for a link state. A browser that cannot start is never connected. */
export function chipOf(state: State, failed = false): { tone: Tone; label: ParseKeys } {
  if (failed) return { tone: 'warning', label: 'connectPage.status.unsupported' };
  return { tone: TONE[state.name], label: STATUS[state.name] };
}

/** One entry of a `getStats()` report: its id, its type and its fields. */
export type StatRow = { id: string; type: string; [field: string]: unknown };

/** Direct when both candidates are local, through STUN when either is a reflexive address. */
export type Path = 'direct' | 'stun' | 'unknown';

export type Endpoint = { address: string | null; port: number | null; kind: string | null };

export type Facts = {
  path: Path;
  local: Endpoint | null;
  remote: Endpoint | null;
  rttMs: number | null;
  /** Bytes the transport has sent and received, the overhead of the channel included. */
  sent: number | null;
  received: number | null;
  /** The report's own clock in milliseconds, so two reports never share a time. */
  at: number | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function endpointOf(row: StatRow | undefined): Endpoint | null {
  if (!row) return null;
  // Older browsers name the address `ip`; newer ones use `address`.
  return {
    address: text(row.address) ?? text(row.ip),
    port: num(row.port),
    kind: text(row.candidateType),
  };
}

function pathOf(local: Endpoint | null, remote: Endpoint | null): Path {
  const kinds = [local?.kind, remote?.kind];
  if (kinds.includes('srflx')) return 'stun';
  if (kinds.every((kind) => kind === 'host' || kind === 'prflx')) return 'direct';
  return 'unknown';
}

/**
 * The facts the popover shows, from a report. The transport names the selected
 * candidate pair; a report without one falls back to the nominated pair that
 * succeeded.
 */
export function factsOf(rows: readonly StatRow[]): Facts {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const transport = rows.find((row) => row.type === 'transport');
  const selected = text(transport?.selectedCandidatePairId);
  const pair =
    (selected === null ? undefined : byId.get(selected)) ??
    rows.find(
      (row) => row.type === 'candidate-pair' && row.nominated === true && row.state === 'succeeded'
    );
  const localId = text(pair?.localCandidateId);
  const remoteId = text(pair?.remoteCandidateId);
  const local = localId === null ? null : endpointOf(byId.get(localId));
  const remote = remoteId === null ? null : endpointOf(byId.get(remoteId));
  const seconds = num(pair?.currentRoundTripTime);
  return {
    path: pathOf(local, remote),
    local,
    remote,
    rttMs: seconds === null ? null : Math.round(seconds * 1000),
    sent: num(transport?.bytesSent) ?? num(pair?.bytesSent),
    received: num(transport?.bytesReceived) ?? num(pair?.bytesReceived),
    at: num(transport?.timestamp) ?? num(pair?.timestamp),
  };
}

/** An address and port as the popover writes them. */
export function endpointText(endpoint: Endpoint | null): string {
  if (!endpoint?.address) return 'Not known';
  const host = endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address;
  return endpoint.port === null ? host : `${host}:${endpoint.port}`;
}

/** A byte counter pair at one moment of the report's clock. */
export type Traffic = { at: number; sent: number; received: number };

/** Bytes per second over an interval, in the same shape as a sample. */
export type Rate = Traffic;

/** The plot spans the last three minutes. */
export const TRAFFIC_WINDOW_MS = 180_000;

/**
 * The samples kept once `next` is added: those within the window ending at
 * `next`. A sample not newer than the last one is not a new reading, so it is
 * dropped.
 */
export function trafficWindow(
  series: readonly Traffic[],
  next: Traffic,
  windowMs = TRAFFIC_WINDOW_MS
): Traffic[] {
  const last = series[series.length - 1];
  if (last && next.at <= last.at) return [...series];
  return [...series, next].filter((sample) => sample.at >= next.at - windowMs);
}

/**
 * Bytes per second between each pair of samples. A counter that ran backwards,
 * as after a reconnect, or an interval of no time, gives no rate.
 */
export function trafficRates(series: readonly Traffic[]): Rate[] {
  const rates: Rate[] = [];
  for (let at = 1; at < series.length; at++) {
    const before = series[at - 1];
    const after = series[at];
    if (!before || !after) continue;
    const seconds = (after.at - before.at) / 1000;
    if (seconds <= 0 || after.sent < before.sent || after.received < before.received) continue;
    rates.push({
      at: after.at,
      sent: (after.sent - before.sent) / seconds,
      received: (after.received - before.received) / seconds,
    });
  }
  return rates;
}

/** SVG points for values on a 0 to `top` scale, oldest first, across a `width` by `height` box. */
function linePoints(values: readonly number[], top: number, width: number, height: number) {
  if (values.length < 2) return '';
  const scale = top > 0 ? top : 1;
  return values
    .map(
      (value, at) =>
        `${((at / (values.length - 1)) * width).toFixed(1)},${(height - (value / scale) * height).toFixed(1)}`
    )
    .join(' ');
}

/**
 * Both lines of the traffic plot on one scale, so they compare. The top is the
 * largest rate of either line, and nothing at all reads as a flat line at zero.
 */
export function ratePlot(
  rates: readonly Rate[],
  width = 240,
  height = 48
): { sent: string; received: string; top: number } {
  const top = Math.max(0, ...rates.flatMap((rate) => [rate.sent, rate.received]));
  return {
    sent: linePoints(
      rates.map((rate) => rate.sent),
      top,
      width,
      height
    ),
    received: linePoints(
      rates.map((rate) => rate.received),
      top,
      width,
      height
    ),
    top,
  };
}
