// The head of a detail page, under the top bar that holds the page's name. It
// has two forms. `facts` is a dotted line of facts with a provenance note, for
// pages without a sport. `meta` adds the sport's glyph, a note on where the
// data came from and an id for the line, for the activity page; its actions are
// at most two primary ones kept in view and one menu for the rest. A setting of
// the item is not an action: it sits in the item's Manage panel.

import type { ReactNode } from 'react';

import { Menu, type MenuItem } from './Menu';

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
  /** The actions kept in view; a missing one is left out. */
  primary?: readonly [ReactNode?, ReactNode?];
  /** The rest of the actions, behind one button; no items draws no button. */
  menu?: { label: string; trigger: string; items: readonly MenuItem[] };
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
  const primary = (props.primary ?? []).filter(Boolean);
  const menu = props.menu && props.menu.items.length > 0 ? props.menu : null;
  return (
    <header id={props.id} className="ui-detail-header">
      <span className="ui-detail-glyph">{props.glyph}</span>
      <div className="ui-detail-meta">
        <p id={props.metaId}>{props.meta}</p>
        {props.note ? <p className="ui-detail-note">{props.note}</p> : null}
      </div>
      {primary.length > 0 || menu ? (
        <div role="group" aria-label={props.actionsLabel} className="ui-detail-actions">
          {primary}
          {menu ? (
            <Menu label={menu.label} trigger={menu.trigger} items={menu.items} size="sm" />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
