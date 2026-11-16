// The sidebar: the pages in three groups, collapsing to icons. The choice is
// kept in this browser.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NAV, type NavKey } from '../pages';
import { RailGlyph } from '../RailGlyph';
import { Button } from '../ui';

/** Where the browser keeps whether the sidebar is collapsed. */
export const SIDEBAR_KEY = 'veloq-connect-sidebar';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function keepCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // A browser that refuses storage still collapses the sidebar for this visit.
  }
}

/** The sidebar's state and the control that flips it, shared with the shell that sizes its column. */
export function useCollapsed(): [collapsed: boolean, toggle: () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  return [
    collapsed,
    () => {
      keepCollapsed(!collapsed);
      setCollapsed(!collapsed);
    },
  ];
}

export function Sidebar({
  current,
  collapsed,
  onToggle,
}: {
  current: NavKey;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav id="rail" aria-label={t('connectPage.railLabel')} data-collapsed={collapsed}>
      <div className="rail-head">
        <p className="brand" aria-hidden="true">
          Veloq
        </p>
        <Button
          id="sidebar-toggle"
          variant="ghost"
          size="sm"
          aria-controls="rail"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'connectPage.nav.expand' : 'connectPage.nav.collapse')}
          onClick={onToggle}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      </div>
      {NAV.map((group) => (
        <div key={group.title} className="group" role="group" aria-labelledby={group.title}>
          <h2 className="group-title" id={group.title}>
            {t(group.title)}
          </h2>
          <ul>
            {group.entries.map((entry) => {
              const selected = entry.key === current;
              return (
                <li key={entry.key}>
                  <a
                    href={entry.href}
                    data-tab={entry.key}
                    aria-current={selected ? 'page' : undefined}
                    title={collapsed ? t(entry.title) : undefined}
                  >
                    <RailGlyph icon={entry.icon} selected={selected} />
                    <span className="label">{t(entry.title)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
