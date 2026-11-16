// Tabs whose selection lives in the address hash, so a tab is linkable and the
// back button steps through them. Arrow keys, Home and End move between tabs.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { stepIndex } from './behaviour';

export type TabItem = { id: string; label: string; panel: ReactNode };

/** The tab a hash names: `#...?tab=ID` or `#...&tab=ID`; the first tab otherwise. */
export function tabFromHash(hash: string, key: string, ids: readonly string[]): string {
  const query = hash.split('?')[1] ?? '';
  const found = new URLSearchParams(query).get(key);
  return found !== null && ids.includes(found) ? found : (ids[0] ?? '');
}

export function hashWithTab(hash: string, key: string, id: string): string {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  params.set(key, id);
  return `#${path}?${params.toString()}`;
}

export function Tabs(props: {
  label: string;
  items: readonly TabItem[];
  param?: string;
  /**
   * The tab the page holds, for a page whose own address would drop a `tab` value; with it the
   * hash is neither read nor written and `onChange` is told each choice.
   */
  value?: string;
  onChange?: (id: string) => void;
}) {
  const key = props.param ?? 'tab';
  const ids = props.items.map((item) => item.id);
  const held = props.value !== undefined;
  const read = () => tabFromHash(window.location.hash, key, ids);
  const [own, setActive] = useState(() => (held ? (ids[0] ?? '') : read()));
  const active = props.value !== undefined && ids.includes(props.value) ? props.value : own;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (held) return undefined;
    const sync = () => setActive(read());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  });
  const choose = (id: string) => {
    setActive(id);
    props.onChange?.(id);
    if (!held) window.location.assign(hashWithTab(window.location.hash, key, id));
  };
  function onKeyDown(event: KeyboardEvent) {
    const to = stepIndex(event.key, ids.indexOf(active), ids.length, false);
    if (to === null) return;
    event.preventDefault();
    buttons.current[to]?.focus();
    const next = ids[to];
    if (next !== undefined) choose(next);
  }
  const current = props.items.find((item) => item.id === active) ?? props.items[0];
  if (!current) return null;
  return (
    <div className="ui-tabs">
      <div role="tablist" aria-label={props.label} className="ui-tablist" onKeyDown={onKeyDown}>
        {props.items.map((item, at) => (
          <button
            key={item.id}
            ref={(node) => {
              buttons.current[at] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={item.id === current.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={item.id === current.id ? 0 : -1}
            onClick={() => choose(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${current.id}`}
        aria-labelledby={`tab-${current.id}`}
        tabIndex={0}
      >
        {current.panel}
      </div>
    </div>
  );
}
