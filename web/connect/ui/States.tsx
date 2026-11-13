// The three non-data states a page shows: nothing to show, loading, and failed.
// Each says what it is in words; the error is an alert with an optional retry.

import type { ReactNode } from 'react';

import { Button } from './Button';

export function EmptyState(props: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="ui-state" role="status">
      <strong>{props.title}</strong>
      {props.detail ? <p>{props.detail}</p> : null}
      {props.action}
    </div>
  );
}

export function Skeleton(props: { lines?: number; label: string }) {
  return (
    <div className="ui-skeleton" role="status" aria-busy="true" aria-label={props.label}>
      {Array.from({ length: props.lines ?? 3 }, (_, index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

export function ErrorState(props: {
  title: string;
  detail?: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="ui-state" data-tone="error" role="alert">
      <strong>
        <span aria-hidden="true">✕ </span>
        {props.title}
      </strong>
      {props.detail ? <p>{props.detail}</p> : null}
      {props.onRetry && props.retryLabel ? (
        <Button variant="secondary" onClick={props.onRetry}>
          {props.retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
