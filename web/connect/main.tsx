// The connect page's start: the session over the window's own APIs, drawn by
// React into #app.

import { createRoot } from 'react-dom/client';

import { App } from './App';
import { parse, restore } from './router';
import { browserEnvironment, createSession } from './session';

const session = createSession(browserEnvironment());
const container = document.getElementById('app');
if (!container) throw new Error('the page has no #app');

createRoot(container).render(<App session={session} />);

if (!location.hash) history.replaceState(null, '', restore(parse(location.hash), location.hash));
void session.start();
