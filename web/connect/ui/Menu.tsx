// A button menu and a right-click context menu. Arrow keys, Home and End move
// between items, Enter or Space chooses one, Escape closes the menu and
// returns focus to what opened it.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { stepIndex } from './behaviour';
import { Button, type ButtonSize } from './Button';

export type MenuItem = { id: string; label: string; onSelect: () => void; disabled?: boolean };

function MenuList(props: {
  label: string;
  items: readonly MenuItem[];
  onClose: () => void;
  style?: { left: number; top: number };
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = props.items.map((item, at) => (item.disabled ? -1 : at)).filter((at) => at >= 0);
  const first = enabled[0];
  useEffect(() => (first === undefined ? undefined : refs.current[first]?.focus()), [first]);
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }
    const here = enabled.indexOf(refs.current.findIndex((node) => node === document.activeElement));
    const to = stepIndex(event.key, here, enabled.length);
    if (to === null) return;
    event.preventDefault();
    const target = enabled[to];
    if (target !== undefined) refs.current[target]?.focus();
  }
  return (
    <div
      role="menu"
      aria-label={props.label}
      className="ui-menu"
      style={props.style}
      onKeyDown={onKeyDown}
    >
      {props.items.map((item, at) => (
        <button
          key={item.id}
          ref={(node) => {
            refs.current[at] = node;
          }}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            props.onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Menu(props: {
  label: string;
  trigger: ReactNode;
  items: readonly MenuItem[];
  size?: ButtonSize;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const close = () => {
    setOpen(false);
    wrap.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
  };
  return (
    <span ref={wrap} className="ui-menu-wrap">
      <Button
        size={props.size ?? 'md'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {props.trigger}
      </Button>
      {open ? (
        <div id={id}>
          <MenuList label={props.label} items={props.items} onClose={close} />
        </div>
      ) : null}
    </span>
  );
}

export function ContextMenu(props: {
  label: string;
  items: readonly MenuItem[];
  children: ReactNode;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  return (
    <div
      className="ui-context-wrap"
      onContextMenu={(event) => {
        event.preventDefault();
        setAt({ left: event.clientX, top: event.clientY });
      }}
    >
      {props.children}
      {at ? (
        <MenuList label={props.label} items={props.items} style={at} onClose={() => setAt(null)} />
      ) : null}
    </div>
  );
}
