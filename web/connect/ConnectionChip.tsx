// The connection chip at the top right of the page, and the popover it opens.
// The popover asks the session for the browser's stats once a second while it
// is open, and never asks the phone.

import type { ParseKeys } from 'i18next';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  chipOf,
  endpointText,
  ratePlot,
  trafficRates,
  trafficWindow,
  type Facts,
  type Rate,
  type Traffic,
} from './connection';
import { elapsed, rate } from './format';
import type { State } from './link';
import type { Session } from './session';

/** How often the popover reads the browser's stats while it is open. */
const SAMPLE_MS = 1000;

const PATH: Record<Facts['path'], ParseKeys> = {
  direct: 'connectPage.connection.pathDirect',
  stun: 'connectPage.connection.pathStun',
  unknown: 'connectPage.connection.pathUnknown',
};

export function ConnectionChip({
  session,
  state,
  failed,
  since,
}: {
  session: Session;
  state: State;
  failed: boolean;
  since: number | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { tone, label } = chipOf(state, failed);
  const live = state.name === 'connected' && !failed && since !== null;
  const phone =
    state.name === 'connected' && state.device ? state.device : t('connectPage.yourPhone');
  const showing = open && live;

  useEffect(() => {
    if (!showing) return undefined;
    function outside(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [showing]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !showing) return;
    // The page's own Escape closes the activity, which this one must not do too.
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div id="connection" ref={wrap} className="connection" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="chip"
        aria-expanded={showing}
        aria-haspopup="dialog"
        aria-controls={showing ? 'connection-details' : undefined}
        disabled={!live}
        onClick={() => setOpen(!showing)}
      >
        <span className={`dot ${tone}`} aria-hidden="true" />
        <span id="status" role="status" aria-live="polite">
          {t(label)}
        </span>
      </button>
      {showing && since !== null ? (
        <ConnectionDetails session={session} since={since} phone={phone} />
      ) : null}
    </div>
  );
}

function ConnectionDetails({
  session,
  since,
  phone,
}: {
  session: Session;
  since: number;
  phone: string;
}) {
  const { t } = useTranslation();
  const [facts, setFacts] = useState<Facts | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    let series: Traffic[] = [];
    let alive = true;
    let busy = false;
    const sample = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await session.connectionFacts();
        if (!alive || !next) return;
        setFacts(next);
        setNow(Date.now());
        if (next.at !== null && next.sent !== null && next.received !== null) {
          series = trafficWindow(series, { at: next.at, sent: next.sent, received: next.received });
          setRates(trafficRates(series));
        }
      } finally {
        busy = false;
      }
    };
    void sample();
    const timer = setInterval(() => void sample(), SAMPLE_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session]);

  const plot = ratePlot(rates);
  const latest = rates[rates.length - 1];
  return (
    <div
      id="connection-details"
      ref={panel}
      role="dialog"
      aria-labelledby="connection-title"
      tabIndex={-1}
      className="details"
    >
      <h2 id="connection-title">{t('connectPage.connection.heading')}</h2>
      <h3 id="connection-phone">{phone}</h3>
      <dl>
        <dt>{t('connectPage.connection.connectedFor')}</dt>
        <dd>{elapsed(now - since)}</dd>
        <dt>{t('connectPage.connection.path')}</dt>
        <dd>{facts ? t(PATH[facts.path]) : t('connectPage.connection.checking')}</dd>
        <dt>{t('connectPage.connection.thisBrowser')}</dt>
        <dd>{endpointText(facts?.local ?? null) ?? t('connectPage.connection.notKnown')}</dd>
        <dt>{t('connectPage.connection.phone')}</dt>
        <dd>{endpointText(facts?.remote ?? null) ?? t('connectPage.connection.notKnown')}</dd>
        <dt>{t('connectPage.connection.roundTrip')}</dt>
        <dd>
          {facts?.rttMs == null ? t('connectPage.connection.notMeasured') : `${facts.rttMs} ms`}
        </dd>
      </dl>
      <figure>
        <svg viewBox="0 0 240 48" role="img" aria-label={t('connectPage.connection.trafficLabel')}>
          <polyline className="received" fill="none" points={plot.received} />
          <polyline className="sent" fill="none" points={plot.sent} />
        </svg>
        <figcaption>
          {t('connectPage.connection.traffic', {
            received: rate(latest?.received ?? 0),
            sent: rate(latest?.sent ?? 0),
          })}
        </figcaption>
      </figure>
    </div>
  );
}
