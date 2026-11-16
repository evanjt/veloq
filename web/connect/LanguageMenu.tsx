// The language menu: every locale the app ships, each by its own name.

import { useTranslation } from 'react-i18next';

import { LANGUAGE_NAMES } from './i18n';
import { Select } from './ui';

export function LanguageMenu({ onChange }: { onChange: (tag: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <Select
      id="language"
      hideLabel
      label={t('connectPage.language')}
      value={i18n.language}
      options={Object.entries(LANGUAGE_NAMES).map(([value, label]) => ({ value, label }))}
      onChange={onChange}
    />
  );
}
