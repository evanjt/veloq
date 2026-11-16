// What the page shows while it is not connected: the pairing code, the banner
// over the page while the link waits for the phone, the prompt to update it,
// and the note a screen shows when the phone lacks its method.

import { useEffect, useRef, type ReactNode } from 'react';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { STATUS, waitingKey } from '../connection';
import type { Notice, State } from '../link';
import type { ReadError, ReadState } from '../query';
import { toQR } from '../qr';
import { Button } from '../ui';

const NOTICE: Record<Notice, ParseKeys> = {
  refused: 'connectPage.notice.refused',
  declined: 'connectPage.notice.declined',
  removed: 'connectPage.notice.removed',
  unreachable: 'connectPage.notice.unreachable',
};

export function PairPane({ state, code }: { state: State; code: string | null }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (code && canvas.current) drawCode(canvas.current, code);
  }, [code]);
  const notice = state.name === 'unpaired' || state.name === 'inviting' ? state.notice : undefined;
  return (
    <section id="pair">
      <h2>{t('connectPage.pair.heading')}</h2>
      <div className="pair-body">
        <div className="pair-code">
          <canvas
            ref={canvas}
            id="code"
            width={360}
            height={360}
            aria-label={t('connectPage.pair.codeLabel')}
          />
          {notice ? (
            <p id="pair-notice" className="notice">
              {t(NOTICE[notice])}
            </p>
          ) : null}
        </div>
        <div className="pair-steps">
          <ol>
            <li>{t('connectPage.pair.step1')}</li>
            <li>{t('connectPage.pair.step2')}</li>
            <li>{t('connectPage.pair.step3')}</li>
          </ol>
          <p className="pair-data">{t('connectPage.footer')}</p>
        </div>
      </div>
    </section>
  );
}

function drawCode(canvas: HTMLCanvasElement, text: string) {
  const modules = toQR(text);
  const size = Math.sqrt(modules.length);
  const quiet = 4;
  const scale = Math.floor(canvas.width / (size + quiet * 2));
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const palette = getComputedStyle(document.documentElement);
  context.fillStyle = palette.getPropertyValue('--colour-neutral-0').trim();
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = palette.getPropertyValue('--colour-neutral-950').trim();
  const offset = Math.floor((canvas.width - size * scale) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x])
        context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
    }
  }
}

/**
 * The banner over the page while the link is trying: what the link is doing, why
 * it is doing it, and a retry that does not wait for the next attempt.
 */
export function LinkBanner({ state, onRetry }: { state: State; onRetry: () => void }) {
  const { t } = useTranslation();
  const label = t(STATUS[state.name]);
  return (
    <div id="link-banner" className="link-banner" role="status">
      <div className="link-banner-text">
        <strong>{label}</strong>
        <span>{t(waitingKey(state))}</span>
      </div>
      <progress className="link-progress" aria-label={label} />
      <Button id="link-retry" variant="secondary" size="sm" onClick={onRetry}>
        {t('connectPage.link.retry')}
      </Button>
    </div>
  );
}

/** In place of a screen whose method the phone does not have; the rest of the page keeps working. */
export function Unsupported() {
  const { t } = useTranslation();
  return (
    <p className="notice" role="status">
      {t('connectPage.update.screen')}
    </p>
  );
}

const READ_FAILURE: Record<Exclude<ReadError['kind'], 'unsupported'>, ParseKeys> = {
  timeout: 'connectPage.read.timeout',
  failed: 'connectPage.read.failed',
};

/**
 * What a panel shows in place of its answer when the read failed. A phone that
 * lacks the method says to update it, which is not a failure; a timeout or a
 * refusal offers to ask again.
 */
export function ReadNotice({
  error,
  onRetry,
}: {
  error: ReadError;
  onRetry?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  if (error.kind === 'unsupported') {
    return (
      <p className="notice" role="status" data-read-error="unsupported">
        {t('connectPage.update.screen')}
      </p>
    );
  }
  return (
    <p className="notice" role="status" data-read-error={error.kind}>
      {t(READ_FAILURE[error.kind])}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('connectPage.read.retry')}
        </Button>
      ) : null}
    </p>
  );
}

/**
 * One read drawn in place: a loading line until the first answer, the typed
 * notice when it failed with nothing held, and the answer otherwise. Older
 * data stays on screen while it is read again.
 */
export function Reading<T>({
  read,
  children,
}: {
  read: ReadState<T> & { retry?: () => void };
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (read.data !== undefined) {
    return (
      <div className="reading" data-refreshing={read.refreshing || undefined}>
        {read.error ? <ReadNotice error={read.error} onRetry={read.retry} /> : null}
        {children(read.data)}
      </div>
    );
  }
  if (read.error) return <ReadNotice error={read.error} onRetry={read.retry} />;
  if (read.loading) {
    return (
      <p className="notice" role="status" aria-busy="true" data-reading="loading">
        {t('connectPage.read.loading')}
      </p>
    );
  }
  return null;
}

export function UpdatePane({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <section id="update">
      <h2>{t('connectPage.update.heading')}</h2>
      <p>{t('connectPage.update.body')}</p>
      <Button id="update-retry" variant="secondary" size="sm" onClick={onRetry}>
        {t('connectPage.link.retry')}
      </Button>
    </section>
  );
}
