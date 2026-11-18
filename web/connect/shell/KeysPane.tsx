// The keyboard help the `?` key opens as a dialog: the pages' digits and `g`
// chords, read from the sidebar's own table, then every shortcut registered, by
// group.

import { useTranslation } from 'react-i18next';

import { NAV } from '../pages';
import { digitOf } from '../palette';
import { useShortcuts, type Shortcut } from '../shortcuts';
import { Dialog } from '../ui/Dialog';

const GROUPS: { group: Shortcut['group']; title: 'connectPage.keys.shell' | 'connectPage.keys.page' }[] = [
  { group: 'shell', title: 'connectPage.keys.shell' },
  { group: 'page', title: 'connectPage.keys.page' },
];

export function KeysPane({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const shortcuts = useShortcuts();
  const pages = NAV.flatMap((group) => group.entries);
  return (
    <Dialog open={open} title={t('connectPage.keys.heading')} onClose={onClose}>
      <section id="keys" aria-label={t('connectPage.keys.heading')}>
        <h3>{t('connectPage.keys.pages')}</h3>
        <dl id="keys-pages">
          {pages.map((page, index) => (
            <div key={page.key} className="key-row">
              <dt>
                <kbd>{digitOf(index)}</kbd>
                {' · '}
                <kbd>g</kbd>
                <kbd>{page.chord}</kbd>
              </dt>
              <dd>{t(page.title)}</dd>
            </div>
          ))}
        </dl>
        {GROUPS.map(({ group, title }) => {
          const entries = shortcuts.filter((shortcut) => shortcut.group === group);
          if (entries.length === 0) return null;
          return (
            <div key={group}>
              <h3>{t(title)}</h3>
              <dl>
                {entries.map((shortcut) => (
                  <div key={`${shortcut.keys.join(' ')}:${shortcut.label}`} className="key-row">
                    <dt>
                      {shortcut.keys.map((key, at) => (
                        <kbd key={at}>{key}</kbd>
                      ))}
                    </dt>
                    <dd>{t(shortcut.label)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </section>
    </Dialog>
  );
}
