// A bordered surface with an optional header: title on the left, actions on the
// right.

import type { ReactNode } from 'react';

export function Card(props: { children: ReactNode; label?: string }) {
  return (
    <section className="ui-card" aria-label={props.label}>
      {props.children}
    </section>
  );
}

export function CardHeader(props: { title: string; actions?: ReactNode }) {
  return (
    <header className="ui-card-header">
      <h2>{props.title}</h2>
      {props.actions ? <div className="ui-card-actions">{props.actions}</div> : null}
    </header>
  );
}
