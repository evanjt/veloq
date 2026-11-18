// The connect page's shell: a top bar that names the screen, a sidebar of the
// pages, and one content pane that scrolls. The page on view is drawn by its
// own module under `pages/`; what is here is the session, the address and the
// keys every page shares. Once the link has connected, the page on view stays
// mounted through a drop and a reconnect, dimmed under a banner, so the athlete
// keeps their place while the link tries again.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';

import { flipTheme, systemPrefersDark, useTheme } from './appearance';
import { setUnitSystem } from './format';
import { pageFor } from './pages';
import { PAGES } from './pages/index';
import { FEED, go, keyAction, parse, withQuery } from './router';
import type { Session } from './session';
import { unitSystem } from './settings';
import { useSettingsReads } from './settingsReads';
import { PAIRING, isLinking } from './connection';
import { CHORD_WINDOW_MS, chordStep, digitTarget, isPaletteKey, pageHref } from './palette';
import { registerShortcuts, useSingleKeyShortcuts } from './shortcuts';
import { CommandPalette } from './shell/CommandPalette';
import { KeysPane } from './shell/KeysPane';
import { PageNameContext } from './shell/pageName';
import { Sidebar, useCollapsed } from './shell/Sidebar';
import { LinkBanner, PairPane, UpdatePane } from './shell/StatePanes';
import { TopBar } from './shell/TopBar';
import { ToastProvider } from './ui';
import { useTranslation } from 'react-i18next';

function subscribeToHash(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** The hash names the route, so the skip link moves focus instead of following it. */
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('content')?.focus();
}

/** The shell under the toasts every page can raise. */
export function App(props: { session: Session; onLanguage: (tag: string) => void }) {
  const { t } = useTranslation();
  return (
    <ToastProvider dismissLabel={t('connectPage.toast.dismiss')}>
      <Shell {...props} />
    </ToastProvider>
  );
}

function Shell({
  session,
  onLanguage,
}: {
  session: Session;
  onLanguage: (tag: string) => void;
}) {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(session.subscribe, session.get);
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const [keysOpen, setKeysOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();
  const chordAt = useRef<number | null>(null);
  const toggleSidebarRef = useRef<() => void>(() => {});
  const [kept, toggleKept] = useCollapsed();
  // The map is the whole page, so its sidebar starts folded to the rail and opens for the visit only.
  const [mapRailOpen, setMapRailOpen] = useState(false);
  const [named, setNamed] = useState<{ route: string; name: string | null } | null>(null);
  const [theme, chooseTheme] = useTheme();

  const { state } = snapshot;
  const connected = state.name === 'connected';
  const pairing = PAIRING.has(state.name);
  const linking = isLinking(state);
  // A page is on view once the link has connected: live while connected, and held
  // under the banner while the link tries again. The session says whether it is held.
  const holding = snapshot.held && linking;
  const route = parse(hash);
  const onMap = route.screen === 'map';
  const collapsed = onMap ? !mapRailOpen : kept;
  const toggleSidebar = onMap ? () => setMapRailOpen((open) => !open) : toggleKept;
  const page = connected || holding ? pageFor(route) : null;
  const Page = page ? PAGES[page.key] : null;

  const { reads } = useSettingsReads();
  const phoneSettings = reads['settings.get']?.values;
  setUnitSystem(
    unitSystem(
      phoneSettings?.find((entry) => entry.key === 'veloq-unit-preference')?.value,
      reads['settings.profile']?.measurementPreference
    )
  );

  useEffect(() => {
    if (!connected) return undefined;
    function onKey(event: KeyboardEvent) {
      if (isPaletteKey(event)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const action = keyAction(
        {
          key: event.key,
          target: event.target as HTMLElement | null,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        },
        singleKeys
      );
      const chord = chordStep(
        {
          key: event.key,
          target: event.target as HTMLElement | null,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        },
        chordAt.current !== null && Date.now() - chordAt.current <= CHORD_WINDOW_MS,
        singleKeys
      );
      chordAt.current = chord.armed ? Date.now() : null;
      if (chord.page) {
        event.preventDefault();
        location.hash = pageHref(chord.page);
        return;
      }
      if (!action) return;
      if (action.do === 'digit') {
        const target = digitTarget(String(action.digit));
        if (target) {
          event.preventDefault();
          location.hash = pageHref(target);
        }
      } else if (action.do === 'palette') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (action.do === 'closeDetail') {
        const current = parse(location.hash);
        if (current.screen === 'activity') go(FEED);
        else if (current.query.some(([key]) => key === 'ids'))
          go(withQuery(current, { ids: null }));
        else go(withQuery(current, { id: null }));
      } else if (action.do === 'help') {
        setKeysOpen((open) => !open);
      }
    }
    document.addEventListener('keydown', onKey);
    const unregister = registerShortcuts([
      {
        keys: [t('connectPage.keys.control'), 'K'],
        label: 'connectPage.keys.palette',
        group: 'shell',
      },
      ...(singleKeys
        ? [{ keys: ['/'], label: 'connectPage.keys.search' as const, group: 'shell' as const }]
        : []),
      { keys: ['Esc'], label: 'connectPage.keys.close', group: 'shell' },
      ...(singleKeys
        ? [{ keys: ['?'], label: 'connectPage.keys.list' as const, group: 'shell' as const }]
        : []),
    ]);
    return () => {
      document.removeEventListener('keydown', onKey);
      unregister();
      setKeysOpen(false);
      setPaletteOpen(false);
    };
  }, [connected, t, singleKeys]);

  useEffect(() => {
    toggleSidebarRef.current = toggleSidebar;
  });

  const paletteActions = useMemo(
    () => [
      {
        id: 'sidebar',
        label: t('connectPage.palette.toggleSidebar'),
        run: () => toggleSidebarRef.current(),
      },
      {
        id: 'theme',
        label: t('connectPage.palette.toggleTheme'),
        run: () => chooseTheme(flipTheme(theme, systemPrefersDark())),
      },
      { id: 'keys', label: t('connectPage.palette.showKeys'), run: () => setKeysOpen(true) },
    ],
    [t, theme, chooseTheme]
  );

  // A name belongs to the address that gave it, so one page's is never read under another's title.
  const address = `${route.screen}/${route.id ?? ''}`;
  const nameThePage = useMemo(
    () => (next: string | null) => setNamed({ route: address, name: next }),
    [address]
  );
  const name = named?.route === address ? named.name : null;

  return (
    <div id="shell" data-sidebar={page ? (collapsed ? 'collapsed' : 'expanded') : 'none'}>
      <a className="skip-link" href="#content" onClick={skipToContent}>
        {t('connectPage.nav.skipToContent')}
      </a>
      <TopBar
        session={session}
        state={state}
        failed={snapshot.failed}
        since={snapshot.connectedSince}
        page={page}
        name={name}
        connected={connected}
        pairing={pairing}
        onLanguage={onLanguage}
        theme={theme}
        onTheme={chooseTheme}
        onPalette={() => setPaletteOpen(true)}
        shortcuts={singleKeys}
        onShortcuts={setSingleKeys}
      />
      {page ? <Sidebar current={page.nav} collapsed={collapsed} onToggle={toggleSidebar} /> : null}
      <main id="content" tabIndex={-1}>
        {snapshot.failed ? (
          <p className="notice" role="status">
            {t('connectPage.unsupported')}
          </p>
        ) : null}
        {pairing ? <PairPane state={state} code={snapshot.code} /> : null}
        {linking ? <LinkBanner state={state} onRetry={session.retry} /> : null}
        {snapshot.writeNotice ? (
          <p id="write-notice" className="notice" role="status">
            {t(snapshot.writeNotice)}
          </p>
        ) : null}
        {state.name === 'update' && <UpdatePane onRetry={session.retry} />}
        {Page ? (
          <div
            className="page-body"
            data-dimmed={connected ? undefined : ''}
            inert={connected ? undefined : true}
          >
            <PageNameContext.Provider value={nameThePage}>
              <Page session={session} snapshot={snapshot} route={route} />
            </PageNameContext.Provider>
          </div>
        ) : null}
        {connected ? <KeysPane open={keysOpen} onClose={() => setKeysOpen(false)} /> : null}
        {connected ? (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            navigate={go}
            actions={paletteActions}
          />
        ) : null}
      </main>
    </div>
  );
}
