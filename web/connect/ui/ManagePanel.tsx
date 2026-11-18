// The one place every setting of an item is changed, shown on the item's own
// page. It is a panel in the page and not a modal, so the toast that offers
// Undo stays in reach while it is open. Focus moves to its first switch when
// it opens and returns to what opened it when it closes; Escape closes it.

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';

import { Button } from './Button';
import { Switch } from './Controls';

export type ManageRow = {
  id: string;
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
};

export type ManageGroup = { id: string; title: string; rows: readonly ManageRow[] };

export function ManagePanel(props: {
  id: string;
  title: string;
  hint?: string;
  closeLabel: string;
  groups: readonly ManageGroup[];
  /** The engine's refusal of the last change, shown until a change is accepted. */
  refusal?: string | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = (globalThis as { document?: Document }).document?.activeElement as
      HTMLElement | null | undefined;
    panel.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
    return () => opener?.focus();
  }, []);
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    props.onClose();
  }
  return (
    <section
      ref={panel}
      id={props.id}
      className="ui-manage"
      role="region"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      <header className="ui-manage-head">
        <h2 id={titleId}>{props.title}</h2>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          {props.closeLabel}
        </Button>
      </header>
      {props.hint ? <p className="ui-manage-hint">{props.hint}</p> : null}
      {props.groups.map((group) => (
        <ManageGroupRows key={group.id} group={group} />
      ))}
      {props.refusal ? (
        <p className="ui-manage-refusal" role="alert">
          {props.refusal}
        </p>
      ) : null}
    </section>
  );
}

function ManageGroupRows({ group }: { group: ManageGroup }) {
  const titleId = useId();
  if (group.rows.length === 0) return null;
  return (
    <div role="group" aria-labelledby={titleId} className="ui-manage-group">
      <h3 id={titleId}>{group.title}</h3>
      {group.rows.map((row) => (
        <Switch
          key={row.id}
          label={row.label}
          checked={row.on}
          disabled={row.disabled}
          onChange={row.onChange}
        />
      ))}
    </div>
  );
}
