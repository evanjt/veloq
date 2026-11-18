// The account menu: the language, the colour scheme, whether single keys act
// as shortcuts, the phone this browser is linked to, and unlinking it. Language,
// scheme and shortcuts are offered while pairing too; the phone and unlink only
// once there is a link.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ThemeChoice } from '../appearance';
import { LanguageMenu } from '../LanguageMenu';
import { Button, SegmentedControl, Switch } from '../ui';

export function AccountMenu({
  phone,
  onLanguage,
  theme,
  onTheme,
  shortcuts,
  onShortcuts,
  onRetry,
  onUnlink,
}: {
  /** The linked phone's name; null while there is no link to name. */
  phone: string | null;
  onLanguage: (tag: string) => void;
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
  /** Whether single-key shortcuts act; Ctrl+K and Escape work either way. */
  shortcuts: boolean;
  onShortcuts: (on: boolean) => void;
  /** Present while the link is trying the phone or the phone needs an update. */
  onRetry: (() => void) | null;
  /** Absent while pairing, when there is nothing to unlink. */
  onUnlink: (() => void) | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus();
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    // The page's own Escape closes the activity, which this one must not do too.
    event.stopPropagation();
    setOpen(false);
    wrap.current?.querySelector<HTMLButtonElement>('#account-button')?.focus();
  }

  return (
    <div id="account" ref={wrap} className="account" onKeyDown={onKeyDown}>
      <Button
        id="account-button"
        variant="ghost"
        size="sm"
        aria-label={t('connectPage.nav.account')}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? 'account-menu' : undefined}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="12" cy="9" r="3.5" fill="none" stroke="currentColor" strokeWidth={1.75} />
          <path
            d="M5 20a7 7 0 0 1 14 0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
          />
        </svg>
      </Button>
      {open ? (
        <div
          id="account-menu"
          ref={panel}
          role="dialog"
          aria-label={t('connectPage.nav.account')}
          tabIndex={-1}
          className="details"
        >
          {phone !== null ? <h2 id="account-phone">{phone}</h2> : null}
          <LanguageMenu onChange={onLanguage} />
          <SegmentedControl
            id="theme"
            label={t('connectPage.settings.values.theme')}
            value={theme}
            options={[
              { value: 'system', label: t('connectPage.settings.options.system') },
              { value: 'light', label: t('connectPage.settings.options.light') },
              { value: 'dark', label: t('connectPage.settings.options.dark') },
            ]}
            onChange={onTheme}
          />
          <Switch
            id="single-key-shortcuts"
            label={t('connectPage.settings.values.singleKeys')}
            checked={shortcuts}
            onChange={onShortcuts}
          />
          <p className="note">{t('connectPage.footer')}</p>
          {onRetry ? (
            <Button id="retry" variant="secondary" size="sm" onClick={onRetry}>
              {t('connectPage.link.retry')}
            </Button>
          ) : null}
          {onUnlink ? (
            <Button id="forget" variant="destructive" size="sm" onClick={onUnlink}>
              {t('connectPage.unlink')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
