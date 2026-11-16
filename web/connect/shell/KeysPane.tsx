// The keyboard help the `?` key toggles: every shortcut registered, by group.

import { useTranslation } from 'react-i18next';

import { useShortcuts, type Shortcut } from '../shortcuts';

const GROUPS: { group: Shortcut['group']; title: 'connectPage.keys.shell' | 'connectPage.keys.page' }[] = [
  { group: 'shell', title: 'connectPage.keys.shell' },
  { group: 'page', title: 'connectPage.keys.page' },
];

export function KeysPane() {
  const { t } = useTranslation();
  const shortcuts = useShortcuts();
  return (
    <section id="keys" aria-label={t('connectPage.keys.heading')}>
      <h2>{t('connectPage.keys.heading')}</h2>
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
  );
}
