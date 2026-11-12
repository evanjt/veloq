// The connect page's start: the session over the window's own APIs, drawn by
// React into #app.

import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { App } from './App';
import { setNumberLocale } from './format';
import { browserLocaleEnv, changeLanguage, startI18n } from './i18n';
import { parse, restore } from './router';
import { browserEnvironment, createSession } from './session';

const session = createSession(browserEnvironment());
const container = document.getElementById('app');
if (!container) throw new Error('the page has no #app');

const localeEnv = browserLocaleEnv();
const { locale, i18n } = await startI18n(localeEnv);
setNumberLocale(locale);
document.title = i18n.t('connectPage.title');

createRoot(container).render(
  <I18nextProvider i18n={i18n}>
    <App
      session={session}
      onLanguage={(tag) =>
        void changeLanguage(localeEnv, i18n, tag).then(() => {
          setNumberLocale(tag);
          document.title = i18n.t('connectPage.title');
        })
      }
    />
  </I18nextProvider>
);

if (!location.hash) history.replaceState(null, '', restore(parse(location.hash), location.hash));
void session.start();
