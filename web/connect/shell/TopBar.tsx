// The top bar: the screen's title with the pages above it, a search entry, the
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
        <Button id="topbar-palette" variant="secondary" size="sm" onClick={onPalette}>
          {t('connectPage.palette.open')} <kbd>{t('connectPage.keys.control')} K</kbd>
        </Button>
      ) : null}
      {connected ? (
        <Button
          id="topbar-search"
          variant="secondary"
          size="sm"
          disabled={!page?.search}
          onClick={() => document.getElementById('search')?.focus()}
        >
          {t('connectPage.nav.search')} <kbd>/</kbd>
        </Button>
      ) : null}
      <ConnectionChip session={session} state={state} failed={failed} since={since} />
      <AccountMenu
        phone={phone}
        onLanguage={onLanguage}
        theme={theme}
        onTheme={onTheme}
        onRetry={canRetry(state) ? session.retry : null}
        onUnlink={pairing ? null : session.unlink}
      />
    </header>
  );
}
