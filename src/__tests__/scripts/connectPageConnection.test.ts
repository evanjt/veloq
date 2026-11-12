/**
 * Scenario: the connect page shows its connection as a chip at the top right,
 * and a popover with the path, the round trip and the traffic, read from the
 * browser's own stats.
 *
 * Expected behaviour: the chip's word follows the link's state. The path is
 * read from the selected candidate pair, and a path through a reflexive
 * address is across networks. Traffic is kept for a window and turned into
 * rates, and a counter that runs backwards gives no rate.
 */

import { createInstance } from 'i18next';

import enGB from '../../i18n/locales/en-GB.json';
import {
  chipOf,
  endpointText,
  factsOf,
  ratePlot,
  trafficRates,
  trafficWindow,
  type StatRow,
  type Traffic,
} from '../../../web/connect/connection';
import { elapsed, rate } from '../../../web/connect/format';
import { step, type State } from '../../../web/connect/link';

const PHONE = 'sha-256 BB:BB';

const strings = createInstance();
void strings.init({
  lng: 'en-GB',
  resources: { 'en-GB': { translation: enGB } },
  initAsync: false,
});

/** The chip as the page shows it in en-GB: its colour and its word. */
function shown(state: State, failed = false) {
  const chip = chipOf(state, failed);
  return { tone: chip.tone, label: strings.t(chip.label) };
}

/** A report with one selected pair, its two candidates and the transport. */
function reportOf(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  transport: Record<string, unknown> = {}
): StatRow[] {
  return [
    {
      id: 'T',
      type: 'transport',
      selectedCandidatePairId: 'P',
      bytesSent: 100,
      bytesReceived: 200,
      timestamp: 5000,
      ...transport,
    },
    {
      id: 'P',
      type: 'candidate-pair',
      localCandidateId: 'L',
      remoteCandidateId: 'R',
      currentRoundTripTime: 0.0421,
      state: 'succeeded',
      nominated: true,
    },
    { id: 'L', type: 'local-candidate', ...local },
    { id: 'R', type: 'remote-candidate', ...remote },
  ];
}

const HOST_LOCAL = { candidateType: 'host', address: '192.0.2.20', port: 52000 };
const HOST_REMOTE = { candidateType: 'host', address: '192.0.2.31', port: 41000 };

describe('the chip', () => {
  it('shows the word and colour for each link state', () => {
    const states: [State, string, string][] = [
      [{ name: 'unpaired' }, 'Not linked', 'idle'],
      [{ name: 'waiting', phone: PHONE, attempt: 0 }, 'Waiting for your phone', 'waiting'],
      [{ name: 'connecting', phone: PHONE, attempt: 0 }, 'Connecting', 'waiting'],
      [{ name: 'connected', phone: PHONE, attempt: 0, methods: null }, 'Connected', 'live'],
      [{ name: 'update', phone: PHONE }, 'Update Veloq on your phone', 'warning'],
    ];
    for (const [state, label, tone] of states) {
      expect(shown(state)).toEqual({ tone, label });
    }
  });

  it('follows the link as the steps move it', () => {
    let state: State = { name: 'unpaired' };
    state = step(state, { type: 'start', phone: PHONE }).state;
    expect(shown(state).label).toBe('Waiting for your phone');
    state = step(state, { type: 'peer' }).state;
    expect(shown(state).label).toBe('Connecting');
    state = step(state, { type: 'open' }).state;
    expect(shown(state)).toEqual({ tone: 'live', label: 'Connected' });
    state = step(state, { type: 'drop' }).state;
    expect(shown(state).label).toBe('Waiting for your phone');
  });

  it('says the browser cannot link whatever the state', () => {
    expect(shown({ name: 'unpaired' }, true)).toEqual({ tone: 'warning', label: 'Not supported' });
  });
});

describe('the path the browser reports', () => {
  it('is direct when both candidates are on the local network', () => {
    const facts = factsOf(reportOf(HOST_LOCAL, HOST_REMOTE));
    expect(facts).toEqual({
      path: 'direct',
      local: { address: '192.0.2.20', port: 52000, kind: 'host' },
      remote: { address: '192.0.2.31', port: 41000, kind: 'host' },
      rttMs: 42,
      sent: 100,
      received: 200,
      at: 5000,
    });
  });

  it('is across networks through STUN when either side is reflexive', () => {
    const facts = factsOf(
      reportOf(HOST_LOCAL, { candidateType: 'srflx', address: '203.0.113.9', port: 41000 })
    );
    expect(facts.path).toBe('stun');
    expect(facts.remote).toEqual({ address: '203.0.113.9', port: 41000, kind: 'srflx' });
  });

  it('reads an older browser that names the address ip', () => {
    const facts = factsOf(
      reportOf({ candidateType: 'host', ip: '192.0.2.4', port: 5000 }, HOST_REMOTE)
    );
    expect(facts.local?.address).toBe('192.0.2.4');
  });

  it('falls back to the nominated pair when the transport names none', () => {
    const rows = reportOf(HOST_LOCAL, HOST_REMOTE).map((row) =>
      row.type === 'transport' ? { ...row, selectedCandidatePairId: undefined } : row
    );
    expect(factsOf(rows).rttMs).toBe(42);
  });

  it('is unknown with no pair in the report, and nothing is shown for it', () => {
    expect(factsOf([])).toEqual({
      path: 'unknown',
      local: null,
      remote: null,
      rttMs: null,
      sent: null,
      received: null,
      at: null,
    });
  });
});

describe('endpoints', () => {
  it('writes an address with its port, and brackets an IPv6 one', () => {
    expect(endpointText({ address: '192.0.2.20', port: 52000, kind: 'host' })).toBe(
      '192.0.2.20:52000'
    );
    expect(endpointText({ address: '2001:db8::1', port: 443, kind: 'host' })).toBe(
      '[2001:db8::1]:443'
    );
    expect(endpointText(null)).toBe('Not known');
  });
});

describe('the traffic plot', () => {
  const sample = (at: number, sent: number, received: number): Traffic => ({
    at,
    sent,
    received,
  });

  it('keeps the samples in the window ending at the newest', () => {
    let series: Traffic[] = [];
    for (let at = 0; at <= 10_000; at += 1000) {
      series = trafficWindow(series, sample(at, at, at), 3000);
    }
    expect(series.map((row) => row.at)).toEqual([7000, 8000, 9000, 10000]);
  });

  it('ignores a sample that is not newer than the last', () => {
    const series = trafficWindow([sample(1000, 0, 0)], sample(1000, 50, 50));
    expect(series).toEqual([sample(1000, 0, 0)]);
  });

  it('turns counters into bytes per second between samples', () => {
    expect(trafficRates([sample(0, 0, 0), sample(2000, 4000, 1000)])).toEqual([
      { at: 2000, sent: 2000, received: 500 },
    ]);
  });

  it('gives no rate over a counter that ran backwards or a zero interval', () => {
    expect(trafficRates([sample(0, 900, 900), sample(1000, 100, 100)])).toEqual([]);
    expect(trafficRates([sample(1000, 0, 0), sample(1000, 40, 40)])).toEqual([]);
  });

  it('scales both lines on one top, and keeps a flat line at zero', () => {
    const plot = ratePlot([
      { at: 1, sent: 0, received: 10 },
      { at: 2, sent: 5, received: 0 },
    ]);
    expect(plot.top).toBe(10);
    expect(plot.received).toBe('0.0,0.0 240.0,48.0');
    expect(plot.sent).toBe('0.0,48.0 240.0,24.0');
    expect(ratePlot([]).sent).toBe('');
    expect(
      ratePlot([
        { at: 1, sent: 0, received: 0 },
        { at: 2, sent: 0, received: 0 },
      ]).sent
    ).toBe('0.0,48.0 240.0,48.0');
  });
});

describe('the figures the popover writes', () => {
  it('counts a live clock as minutes and seconds, and hours past an hour', () => {
    expect(elapsed(65_000)).toBe('1:05');
    expect(elapsed(3_725_000)).toBe('1:02:05');
    expect(elapsed(-400)).toBe('0:00');
  });

  it('writes a rate in bytes, then kilobytes', () => {
    expect(rate(0)).toBe('0 B/s');
    expect(rate(999)).toBe('999 B/s');
    expect(rate(1500)).toBe('1.5 kB/s');
  });
});
