// A filter chip: a toggle that is on or off. The on state carries a check mark
// and `aria-pressed` besides the ground colour.

import type { ReactNode } from 'react';

export function Chip(props: {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ui-chip"
      aria-pressed={props.selected}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      {props.selected ? <span aria-hidden="true">✓</span> : null}
      {props.children}
    </button>
  );
}

export function ChipGroup(props: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={props.label} className="ui-chips">
      {props.children}
    </div>
  );
}
