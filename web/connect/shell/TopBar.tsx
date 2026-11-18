// The top bar: the screen's title with the pages above it, the one search, the
// link's status and the account menu.

import { useTranslation } from 'react-i18next';

import { ConnectionChip } from '../ConnectionChip';
import { canRetry } from '../connection';
import type { State } from '../link';
import type { ThemeChoice } from '../appearance';
import type { PageInfo } from '../pages';
import type { Session } from '../session';
import { Button } from '../ui';
import { AccountMenu } from './AccountMenu';

export function TopBar({
  session,
  state,
  failed,
  since,
  page,
  name,
  connected,
  pairing,
  onLanguage,
  theme,
  onTheme,
  onPalette,
  shortcuts,
  onShortcuts,
}: {
  session: Session;
  state: State;
  failed: boolean;
  since: number | null;
  /** The page on view; absent until the link is connected. */
  page: PageInfo | null;
  /** What a page that shows one named thing has named it, or null while it loads. */
  name: string | null;
  connected: boolean;
  pairing: boolean;
  onLanguage: (tag: string) => void;
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
  onPalette: () => void;
  /** Whether the single-key shortcuts are on. */
  shortcuts: boolean;
  onShortcuts: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const title = page ? (page.named && name ? name : t(page.title)) : 'Veloq';
  const phone = pairing
    ? null
    : state.name === 'connected' && state.device
      ? state.device
      : t('connectPage.yourPhone');
  return (
    <header id="topbar">
      <div className="heading">
        {page && page.parents.length > 0 ? (
          <nav id="breadcrumb" aria-label={t('connectPage.nav.breadcrumb')}>
            <ol>
              {page.parents.map((crumb) => (
                <li key={crumb.href}>
                  <a href={crumb.href}>{t(crumb.title)}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1>{title}</h1>
      </div>
      {connected ? (
        <Button id="topbar-search" variant="secondary" size="sm" aria-haspopup="dialog" onClick={onPalette}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth={1.75} />
            <path d="M16 16l4 4" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
          </svg>
          <span className="topbar-search-text">{t('connectPage.nav.search')}</span>
          <kbd>{t('connectPage.keys.control')} K</kbd>
        </Button>
      ) : null}
      <ConnectionChip session={session} state={state} failed={failed} since={since} />
      <AccountMenu
        phone={phone}
        onLanguage={onLanguage}
        theme={theme}
        onTheme={onTheme}
        shortcuts={shortcuts}
        onShortcuts={onShortcuts}
        onRetry={canRetry(state) ? session.retry : null}
        onUnlink={pairing ? null : session.unlink}
      />
    </header>
  );
}
