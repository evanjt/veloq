// The language menu: every locale the app ships, each by its own name.

import { useTranslation } from 'react-i18next';

import { LANGUAGE_NAMES } from './i18n';

export function LanguageMenu({ onChange }: { onChange: (tag: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <select
      id="language"
      value={i18n.language}
      aria-label={t('connectPage.language')}
      onChange={(event) => onChange(event.target.value)}
    >
      {Object.entries(LANGUAGE_NAMES).map(([tag, name]) => (
        <option key={tag} value={tag} lang={tag}>
          {name}
        </option>
      ))}
    </select>
  );
}
