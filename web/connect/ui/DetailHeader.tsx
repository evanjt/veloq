// The head of a detail page, under the top bar that holds the page's name. It
// has two forms. `facts` is a dotted line of facts with a provenance note, for
// pages without a sport. `meta` adds the sport's glyph, a note on where the
// data came from and an id for the line, for the activity page.

import type { ReactNode } from 'react';

type Facts = {
  /** The facts in reading order, each shown when present, joined by a dot. */
  facts: (string | null | undefined)[];
  provenance?: string;
  actions?: ReactNode;
};

type Meta = {
  id?: string;
  glyph: ReactNode;
  /** The id of the line saying when and what, for a test or a link to read. */
  metaId?: string;
  meta: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  actionsLabel?: string;
};

export function DetailHeader(props: Facts | Meta) {
  if ('facts' in props) {
    const facts = props.facts.filter((fact): fact is string => Boolean(fact));
    return (
      <header className="detail-head">
        <p className="detail-facts">
          {facts.join(' · ')}
          {props.provenance ? <span className="detail-provenance">{props.provenance}</span> : null}
        </p>
        {props.actions ? <div className="detail-actions">{props.actions}</div> : null}
      </header>
    );
  }
  return (
    <header id={props.id} className="ui-detail-header">
      <span className="ui-detail-glyph">{props.glyph}</span>
      <div className="ui-detail-meta">
        <p id={props.metaId}>{props.meta}</p>
        {props.note ? <p className="ui-detail-note">{props.note}</p> : null}
      </div>
      {props.actions ? (
        <div role="group" aria-label={props.actionsLabel} className="ui-detail-actions">
          {props.actions}
        </div>
      ) : null}
    </header>
  );
}
